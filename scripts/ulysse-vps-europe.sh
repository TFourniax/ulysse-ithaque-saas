#!/usr/bin/env bash
# Ulysse demo only. Run as Linux user ulysse (UID 10002), never as root.
# audit | diagnose [tenant-slug] | deploy <commit> | status | model MODEL_ID|/chemin/profil.json | rollback
# This script never runs a global docker command, down, prune, seed or reset.
set -Eeuo pipefail
umask 077
cd /
ULYSSE_HOME_DIR=/var/lib/ulysse/home
ULYSSE_REPO="$ULYSSE_HOME_DIR/projects/ulysse-ul016"
ULYSSE_PRIVATE="$ULYSSE_HOME_DIR/private"
ULYSSE_RELEASES="$ULYSSE_PRIVATE/november-releases"
ULYSSE_ACTIVE="$ULYSSE_PRIVATE/november-active"
ULYSSE_SOCKET=/run/user/10002/docker.sock
ULYSSE_PROJECT=ulysse
ULYSSE_SCRIPT_VERSION=2026-10-20.models2
die() { printf 'ARRET : %s\n' "$*" >&2; return 1; }
say() { printf '%s\n' "$*"; }
[[ $(hostname) == hermes-prospection-prod ]] || die 'VPS inattendu'
[[ $(id -un) == ulysse && $(id -u) == 10002 ]] || die 'utiliser sudo -Hu ulysse bash /tmp/ulysse-vps-europe.sh ...'
[[ -S "$ULYSSE_SOCKET" ]] || die "socket rootless absent : $ULYSSE_SOCKET"
for program in docker git python3 openssl flock sha256sum; do command -v "$program" >/dev/null || die "$program absent"; done
ud() { docker --host "unix://$ULYSSE_SOCKET" "$@"; }
uc_file() { local cfg=$1; shift; ud compose -p "$ULYSSE_PROJECT" -f "$cfg" --profile app --profile agent --profile agent-stub "$@"; }
uc_original() {
  ud compose -p "$ULYSSE_PROJECT" \
    -f "$ULYSSE_REPO/infra/compose.yaml" -f "$ULYSSE_REPO/infra/hermes.compose.yaml" \
    -f "$ULYSSE_PRIVATE/compose.vps.yaml" -f "$ULYSSE_PRIVATE/compose.https.yaml" \
    --env-file "$ULYSSE_PRIVATE/stack.env" --profile app --profile agent --profile agent-stub "$@"
}
container_id() { ud ps -q --filter "label=com.docker.compose.project=$ULYSSE_PROJECT" --filter "label=com.docker.compose.service=$1"; }
current_config() {
  if [[ -f "$ULYSSE_ACTIVE" ]]; then
    local cfg; cfg=$(cat "$ULYSSE_ACTIVE")
    [[ "$cfg" == "$ULYSSE_RELEASES/"* && -f "$cfg" ]] || die 'pointeur de version invalide'
    uc_file "$cfg" config --format json
  else uc_original config --format json; fi
}
audit() {
  say "Script : $ULYSSE_SCRIPT_VERSION (Europe + ZDR, configuration active conservee)"
  say "VPS : $(hostname) | compte : $(id -un) | UID : $(id -u) | socket : $ULYSSE_SOCKET"
  ud info --format '{{json .SecurityOptions}}' | python3 -c 'import json,sys; assert any("rootless" in x for x in json.load(sys.stdin)), "Docker non rootless"'
  ud ps --filter "label=com.docker.compose.project=$ULYSSE_PROJECT" --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
  git -C "$ULYSSE_REPO" log -1 --format='Depot historique : %h %s'
  git -C "$ULYSSE_REPO" status --short
  local api; api=$(container_id api)
  [[ -n "$api" && "$api" != *$'\n'* ]] || die 'un unique conteneur API Ulysse actif est requis'
  ud exec "$api" node -e 'for(const k of ["PUBLIC_ORIGIN","ULYSSE_DB_NAME","ULYSSE_ANALYSIS_MODE"]) console.log(k+"="+(process.env[k]||""));'
  local worker; worker=$(container_id worker)
  [[ -n "$worker" && "$worker" != *$'\n'* ]] || die 'un unique worker Ulysse actif est requis'
  ud exec "$worker" node -e 'console.log("mode_worker="+process.env.ULYSSE_ANALYSIS_MODE); console.log("cle_fournisseur_presente="+Boolean(process.env.OPENROUTER_API_KEY)); for(const k of ["AGENT_MODEL_ID","AGENT_PROVIDER_ROUTE","AGENT_RUN_BUDGET_USD","AGENT_SESSION_BUDGET_USD","AGENT_MONTH_BUDGET_USD"]) console.log(k+"="+(process.env[k]||""));'
  ud exec "$worker" node --input-type=module -e '
    try {
      const {agentProvider}=await import("./apps/worker/dist/src/agent-provider.js");
      const p=agentProvider(process.env.AGENT_MODEL_ID,process.env.AGENT_PROVIDER_ROUTE||"openrouter",process.env.AGENT_MODEL_PROFILE_JSON||undefined);
      if(p.profile) console.log("profil="+p.profile.id+" | empreinte="+p.profileHash+" | sortie_max="+p.profile.generation.maxOutputTokens+" | raisonnement="+p.profile.generation.reasoning);
    } catch { console.log("profil_declaratif=indisponible"); }
  '
  if [[ -f "$ULYSSE_ACTIVE" ]]; then say "Configuration active : $(cat "$ULYSSE_ACTIVE")"; fi
}
check_health() {
  local api worker; api=$(container_id api); worker=$(container_id worker)
  [[ -n "$api" && -n "$worker" ]] || die 'API ou worker absent'
  ud exec "$api" node -e 'fetch("http://127.0.0.1:3000/health/ready").then(async r=>{console.log("API",r.status,await r.text());if(!r.ok)process.exit(1)},()=>process.exit(1))'
  ud exec "$worker" node -e 'fetch("http://127.0.0.1:3001/health/ready").then(async r=>{console.log("WORKER",r.status,await r.text());if(!r.ok)process.exit(1)},()=>process.exit(1))'
  ud exec "$worker" node --input-type=module -e '
    const m=await import("./apps/worker/dist/src/agent-runtime.js");
    if(m.EXECUTION_CONTRACT && ["hermes-live","hermes-stub"].includes(process.env.ULYSSE_ANALYSIS_MODE)) {
      const response=await fetch("http://hermes:8090/health",{signal:AbortSignal.timeout(5000)});
      const h=await response.json();
      if(!response.ok || h.executionContract!==m.EXECUTION_CONTRACT || h.hermesCommit!==m.HERMES_COMMIT || h.instructionsSha256!==m.AGENT_INSTRUCTIONS_SHA256 || h.workflowInstructionsSha256!==m.WORKFLOW_INSTRUCTIONS_SHA256) throw new Error("Contrat Hermes incompatible");
      console.log("HERMES contrat et instructions compatibles");
    }
  '

}
diagnose() {
  local slug=${1:-acme-demo} worker postgres hermes database
  [[ "$slug" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]] || die 'identifiant entreprise invalide'
  worker=$(container_id worker); postgres=$(container_id postgres); hermes=$(container_id hermes)
  for cid in "$worker" "$postgres" "$hermes"; do
    [[ -n "$cid" && "$cid" != *$'\n'* ]] || die 'conteneur Ulysse absent ou ambigu'
  done
  database=$(ud exec "$worker" node -e 'process.stdout.write(process.env.ULYSSE_DB_NAME||"")')
  [[ -n "$database" ]] || die 'base Ulysse non determinee'
  say 'Diagnostic en lecture seule : aucun appel modele, aucune modification.'
  ud logs --timestamps --since 24h --tail 50 "$hermes" 2>&1
  ud logs --since 24h --tail 500 "$worker" 2>&1 | python3 -c '
import json,sys
for line in sys.stdin:
    try: row=json.loads(line)
    except ValueError: continue
    if isinstance(row,dict) and row.get("msg") in ("agent gateway refused a call","agent provider failed","agent run not published"):
        print(json.dumps({k:row.get(k) for k in ("time","msg","runId","path","reason","httpStatus")},ensure_ascii=False))
'
  ud exec -i "$postgres" sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1 -P pager=off -v tenant_slug="$2" -x' sh "$database" "$slug" <<'SQL'
BEGIN READ ONLY;
SELECT r.id,r.workflow_kind,r.model,r.status,r.error_code,r.started_at,
       round(extract(epoch FROM (r.completed_at-r.started_at))::numeric,1) AS duration_seconds,
       r.model_calls,r.tool_calls,r.input_tokens,r.output_tokens,r.uncertain_calls,
       r.cost_state,r.committed_usd,
       ARRAY(SELECT e.label FROM agent_events e
             WHERE e.tenant_id=r.tenant_id AND e.run_id=r.id AND e.kind='tool'
             ORDER BY e.sequence) AS tools_used
FROM agent_runs r JOIN tenants t ON t.id=r.tenant_id
WHERE t.slug=:'tenant_slug' AND r.workflow_kind IN ('buyer','content')
ORDER BY r.started_at DESC LIMIT 3;
ROLLBACK;
SQL
}
ULYSSE_RESTORE_CONFIG=''
ULYSSE_STOPPED=0
declare -a ULYSSE_SERVICES=()
on_error() {
  local code=${1:-$?}
  trap - ERR INT TERM HUP
  if [[ "$ULYSSE_STOPPED" == 1 && -f "$ULYSSE_RESTORE_CONFIG" ]]; then
    say 'Echec : retour aux images et reglages precedents.'
    if uc_file "$ULYSSE_RESTORE_CONFIG" up -d --no-deps --no-build --pull never --wait --wait-timeout 300 "${ULYSSE_SERVICES[@]}"; then
      printf '%s\n' "$ULYSSE_RESTORE_CONFIG" > "$ULYSSE_ACTIVE"
      say 'Version precedente redemarree ; un ancien profil global est remis en rules. Migrations conservees.'
    else say "Retour automatique incomplet. Configuration de reprise : $ULYSSE_RESTORE_CONFIG"; fi
  fi
  say "Commande interrompue (code $code). Ne pas poursuivre avec une etape suivante."
  exit "$code"
}
trap on_error ERR
trap 'on_error 130' INT
trap 'on_error 143' TERM
trap 'on_error 129' HUP
action=${1:-audit}
case "$action" in
  audit) audit; exit 0 ;;
  status) audit; check_health; exit 0 ;;
  diagnose) diagnose "${2:-acme-demo}"; exit 0 ;;
  deploy|model|rollback) ;;
  models)
    worker=$(container_id worker)
    [[ -n "$worker" && "$worker" != *$'\n'* ]] || die 'worker Ulysse absent ou ambigu'
    ud exec "$worker" node --input-type=module -e 'import {modelProfiles} from "./apps/worker/dist/src/agent-provider.js"; console.log(JSON.stringify(modelProfiles(),null,2))'
    exit 0 ;;
  *) die 'actions : audit | diagnose [tenant] | deploy COMMIT | status | model MODEL_ID|/chemin/profil.json | rollback' ;;
esac
mkdir -p "$ULYSSE_RELEASES"
exec 9>"$ULYSSE_PRIVATE/november-deploy.lock"
flock -n 9 || die 'une autre operation Ulysse est deja en cours'
if [[ "$action" != rollback ]]; then audit; fi

if [[ "$action" == rollback ]]; then
  [[ -f "$ULYSSE_ACTIVE" ]] || die 'aucune version installee par ce script'
  cfg=$(cat "$ULYSSE_ACTIVE"); release=$(dirname "$cfg")
  [[ "$release" == "$ULYSSE_RELEASES/"* && -f "$release/rollback.json" ]] || die 'configuration de retour absente'
  mapfile -t ULYSSE_SERVICES < "$release/services.txt"
  uc_file "$cfg" stop -t 100 "${ULYSSE_SERVICES[@]}"
  uc_file "$release/rollback.json" up -d --no-deps --no-build --pull never --wait --wait-timeout 300 "${ULYSSE_SERVICES[@]}"
  printf '%s\n' "$release/rollback.json" > "$ULYSSE_ACTIVE"
  check_health
  say 'Version precedente reactivee ; si elle etait globale, moteur desactive (rules). Donnees conservees.'
  exit 0
fi

# No automatic inference is performed by preflight; only public/authenticated catalogs.
preflight() {
  uc_file "$1" run --rm --no-deps worker node --input-type=module -e '
    import {agentConfig} from "./apps/worker/dist/src/agent-runtime.js";
    import {checkEuropeanProvider} from "./apps/worker/dist/src/agent-provider-check.js";
    try {
      const c=agentConfig();
      if(c.ULYSSE_ANALYSIS_MODE!=="hermes-live" || c.AGENT_PROVIDER_ROUTE!=="openrouter-eu-zdr") throw new Error("Profil Europe live requis");
      console.log(JSON.stringify(await checkEuropeanProvider(c.AGENT_MODEL_ID,c.OPENROUTER_API_KEY,fetch,c.AGENT_MODEL_PROFILE_JSON)));
      console.log("Catalogue et endpoint ZDR verifies ; inference live et qualite restant a tester.");
    } catch(e) { console.error(e.message); process.exit(1); }
  '
}
if [[ "$action" == model ]]; then
  target_model=${2:-}
  case "$target_model" in
    glm) target_model=z-ai/glm-5.3-flash ;;
    haiku) target_model=anthropic/claude-haiku-5.5 ;;
    gpt41) target_model=openai/gpt-4.1-mini ;;
    mistral) target_model=mistralai/mistral-small-2603 ;;
    '') die 'fournir un identifiant de modele ou le chemin absolu de son profil JSON' ;;
  esac
  [[ -f "$ULYSSE_ACTIVE" ]] || die 'installer UL-019 avant de changer de modele'
  cfg=$(cat "$ULYSSE_ACTIVE")
  [[ "$cfg" == "$ULYSSE_RELEASES/"* && -f "$cfg" ]] || die 'configuration active invalide'
  release=$(mktemp -d "$ULYSSE_RELEASES/model-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
  current_config > "$release/rollback.json"
  worker=$(container_id worker)
  [[ -n "$worker" && "$worker" != *$'\n'* ]] || die 'worker Ulysse absent ou ambigu'
  ud inspect "$worker" > "$release/worker.inspect.json"
  python3 - "$release" <<'PYDRIFT'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1]); expected=json.loads((p/'rollback.json').read_text())['services']['worker'].get('environment',{})
running=json.loads((p/'worker.inspect.json').read_text())[0]
actual=dict(x.split('=',1) for x in running['Config']['Env'])
for k,v in expected.items():
    if str(v).replace('$$','$') != actual.get(k): raise SystemExit(f'ARRET : ecart de configuration worker, variable {k}.')
PYDRIFT
  cp "$ULYSSE_ACTIVE" "$release/previous-active.txt"
  printf '%s\n' api worker > "$release/services.txt"
  python3 - "$release" "$target_model" <<'PYMODEL'
import json,sys,pathlib,copy
p=pathlib.Path(sys.argv[1]); c=json.loads((p/'rollback.json').read_text())
e=c['services']['worker']['environment']
if e.get('AGENT_PROVIDER_ROUTE')!='openrouter-eu-zdr': raise SystemExit('ARRET : deploy Europe requis avant model.')
if c['services']['api']['environment'].get('ULYSSE_ANALYSIS_MODE')!='hermes-live' or e.get('ULYSSE_ANALYSIS_MODE')!='hermes-live': raise SystemExit('ARRET : mode live Europe requis.')
selector=sys.argv[2]
if selector.startswith('/'):
    profile_path=pathlib.Path(selector)
    if not profile_path.is_file() or profile_path.stat().st_size>16384: raise SystemExit('ARRET : fichier de profil absent ou trop volumineux.')
    try: profile=json.loads(profile_path.read_text())
    except (ValueError, UnicodeError): raise SystemExit('ARRET : profil JSON invalide.') from None
    if not isinstance(profile,dict) or not isinstance(profile.get('model'),str): raise SystemExit('ARRET : profil sans identifiant modele.')
    e['AGENT_MODEL_ID']=profile['model']
    # Compose interpolates dollar signs in values. Preserve them exactly; the runtime schema
    # then rejects unknown fields, URLs, credentials, plugins and out-of-bound settings.
    e['AGENT_MODEL_PROFILE_JSON']=json.dumps(profile,separators=(',',':')).replace('$','$$')
else:
    e['AGENT_MODEL_ID']=selector
    e['AGENT_MODEL_PROFILE_JSON']=''
(p/'deploy.json').write_text(json.dumps(c,indent=2))
PYMODEL
  preflight "$release/deploy.json"
  ULYSSE_RESTORE_CONFIG="$release/rollback.json"
  ULYSSE_SERVICES=(api worker)
  ULYSSE_STOPPED=1
  uc_file "$cfg" stop -t 100 api worker
  uc_file "$release/deploy.json" up -d --no-deps --no-build --pull never --wait --wait-timeout 300 api worker
  check_health
  printf '%s\n' "$release/deploy.json" > "$ULYSSE_ACTIVE"
  ULYSSE_STOPPED=0
  say "Modele actif : $target_model | Europe + ZDR | budgets et session conserves."
  exit 0
fi

revision=${2:-}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || die 'fournir le SHA complet valide de la version novembre'
git -C "$ULYSSE_REPO" diff --quiet && git -C "$ULYSSE_REPO" diff --cached --quiet || die 'correctifs locaux suivis par Git : les conserver et les examiner avant la mise a jour'
# Mettre aussi a jour la reference distante dans les clones mono-branche.
git -C "$ULYSSE_REPO" fetch origin \
  refs/heads/codex/ul-019-model-profiles:refs/remotes/origin/codex/ul-019-model-profiles
git -C "$ULYSSE_REPO" cat-file -e "$revision^{commit}"
git -C "$ULYSSE_REPO" merge-base --is-ancestor "$revision" origin/codex/ul-019-model-profiles || die 'commit hors de la branche profils UL-019'
git -C "$ULYSSE_REPO" merge-base --is-ancestor HEAD "$revision" || die 'le depot VPS contient une lignee qui manque dans la version demandee'
release=$(mktemp -d "$ULYSSE_RELEASES/${revision:0:7}-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
current_config > "$release/before.json"
if [[ -f "$ULYSSE_ACTIVE" ]]; then cp "$ULYSSE_ACTIVE" "$release/previous-active.txt"; else : > "$release/previous-active.txt"; fi
# COPY conserve les permissions : les utilisateurs non root des images doivent
# pouvoir lire le code. Le parent release reste prive (0700), comme les secrets.
# Le sous-shell limite umask 022 au checkout ; le reste conserve umask 077.
(
  umask 022
  git -C "$ULYSSE_REPO" worktree add --detach "$release/source" "$revision"
)
printf '%s\n' "$revision" > "$release/revision.txt"
for service in api worker hermes model-stub; do
  id=$(container_id "$service")
  if [[ -n "$id" ]]; then
    [[ "$id" != *$'\n'* ]] || die "plusieurs conteneurs $service"
    ULYSSE_SERVICES+=("$service")
    ud inspect "$id" > "$release/$service.inspect.json"
  fi
done
printf '%s\n' "${ULYSSE_SERVICES[@]}" > "$release/services.txt"
tag="ul019-${revision:0:12}-$(date -u +%s)"
python3 - "$release" "$tag" <<'PY'
import json,sys,pathlib,copy
d=pathlib.Path(sys.argv[1]); c=json.loads((d/'before.json').read_text()); old=copy.deepcopy(c)
api_mode=c['services']['api']['environment'].get('ULYSSE_ANALYSIS_MODE','rules')
worker_mode=c['services']['worker']['environment'].get('ULYSSE_ANALYSIS_MODE','rules')
if api_mode != worker_mode: raise SystemExit('ARRET : modes API et worker differents.')
for service in (d/'services.txt').read_text().splitlines():
    running=json.loads((d/f'{service}.inspect.json').read_text())[0]
    actual=dict(x.split('=',1) for x in running['Config']['Env'])
    for k,v in c['services'][service].get('environment',{}).items():
        if str(v).replace('$$','$') != actual.get(k): raise SystemExit(f'ARRET : ecart de configuration du conteneur {service}, variable {k}.')
    for mount in running.get('Mounts',[]):
        target=mount['Destination']
        if target=='/' or any(target==p or target.startswith(p+'/') or p.startswith(target.rstrip('/')+'/') for p in ('/app','/opt/ulysse','/opt/hermes')):
            raise SystemExit(f'ARRET : montage local de code a examiner pour {service}.')
    old['services'][service]['image']=running['Image']
for service in ('api','worker','db-init','demo-seed'):
    c['services'][service]['image']='ulysse-app:'+sys.argv[2]
for service in ('hermes','model-stub'):
    if service in c['services']: c['services'][service]['image']='ulysse-hermes:'+sys.argv[2]
# The user's explicit live activation is retained. No key/session/budget is created or reset.
e=c['services']['worker']['environment']
if api_mode!='hermes-live' or worker_mode!='hermes-live' or len(e.get('OPENROUTER_API_KEY','') or '')<16:
    raise SystemExit('ARRET : cette mise a niveau exige le mode live et la cle deja actifs.')
e['AGENT_MODEL_ID']='z-ai/glm-5.3-flash'
e['AGENT_MODEL_PROFILE_JSON']=''
e['AGENT_PROVIDER_ROUTE']='openrouter-eu-zdr'
e['AGENT_STUB_PROVIDER_URL']=''
# On a failed cutover, restore availability without resuming global inference.
if old['services']['worker']['environment'].get('AGENT_PROVIDER_ROUTE')!='openrouter-eu-zdr':
    for name in ('api','worker'): old['services'][name]['environment']['ULYSSE_ANALYSIS_MODE']='rules'
for config in (c,old):
    for service in config['services'].values(): service.pop('build',None)
(d/'rollback.json').write_text(json.dumps(old,indent=2))
(d/'deploy.json').write_text(json.dumps(c,indent=2))
db=c['services']['api']['environment']['ULYSSE_DB_NAME']
(d/'database.txt').write_text(db)
PY
uc_file "$release/deploy.json" config --quiet
database=$(cat "$release/database.txt")
postgres=$(container_id postgres)
[[ -n "$postgres" && "$postgres" != *$'\n'* ]] || die 'PostgreSQL Ulysse absent ou ambigu'
ud exec "$postgres" sh -c 'exec psql -U "$POSTGRES_USER" -d "$1" -At -v ON_ERROR_STOP=1 -c "SELECT json_agg(row_to_json(m)) FROM public.schema_migrations m"' sh "$database" > "$release/migrations-before.json"
python3 - "$release" <<'PY'
import json,hashlib,pathlib,sys
d=pathlib.Path(sys.argv[1])
for row in json.load(open(d/'migrations-before.json')):
    f=d/'source/packages/database/migrations'/row['version']
    if not f.is_file() or hashlib.sha256(f.read_bytes()).hexdigest()!=row['checksum']:
        raise SystemExit('ARRET : migration historique absente ou modifiee : '+row['version'])
print('Migrations historiques compatibles.')
PY
say 'Construction des deux images ; la demo reste en service pendant cette etape.'
ud build --label "org.opencontainers.image.revision=$revision" -t "ulysse-app:$tag" "$release/source"
ud build --label "org.opencontainers.image.revision=$revision" -f "$release/source/services/hermes/Dockerfile" -t "ulysse-hermes:$tag" "$release/source"
preflight "$release/deploy.json"
ULYSSE_RESTORE_CONFIG="$release/rollback.json"
ULYSSE_STOPPED=1
say 'Courte interruption Ulysse : sauvegarde, migration et remplacement des services applicatifs.'
uc_file "$release/before.json" stop -t 100 "${ULYSSE_SERVICES[@]}"
openssl rand -base64 48 > "$release/backup.key"
ud exec "$postgres" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$1" -Fc' sh "$database" | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$release/backup.key" -out "$release/database.dump.enc"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$release/backup.key" -in "$release/database.dump.enc" | ud exec -i "$postgres" sh -c 'umask 077; check_dump=$(mktemp /tmp/ulysse-check.XXXXXX); trap "rm -f \"$check_dump\"" EXIT; cat > "$check_dump"; pg_restore --list "$check_dump"' > "$release/backup-index.txt"
[[ -s "$release/backup-index.txt" ]]
sha256sum "$release/database.dump.enc" > "$release/database.dump.enc.sha256"
uc_file "$release/deploy.json" run --rm --no-deps db-init node packages/database/dist/src/cli.js migrate
uc_file "$release/deploy.json" up -d --no-deps --no-build --pull never --wait --wait-timeout 300 "${ULYSSE_SERVICES[@]}"
check_health
printf '%s\n' "$release/deploy.json" > "$ULYSSE_ACTIVE"
ULYSSE_STOPPED=0
say "Version installee : $revision"
say "Sauvegarde et retour arriere : $release"
say 'Sauvegarde chiffree et catalogue lisible ; cela ne remplace pas un exercice complet de restauration.'
say 'GLM 5.3 Flash actif : Europe + ZDR. Budgets/session/cle conserves. Tester les trois parcours sur https://demo-ulysse.paitite.com.'
