"""Exercise the actual deployment config transformation, without Docker or credentials."""
import copy
import contextlib
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("ulysse-vps-europe.sh").read_text()
TRANSFORM = re.search(r'python3 - "\$release" "\$tag"[^\n]* <<\'PY\'\n(.*?)\nPY', SCRIPT, re.S).group(1)
MODEL_TRANSFORM = re.search(r'<<\'PYMODEL\'\n(.*?)\nPYMODEL', SCRIPT, re.S).group(1)
RESEARCH_TRANSFORM = re.search(r'<<\'PYRESEARCH\'\n(.*?)\nPYRESEARCH', SCRIPT, re.S).group(1)


class DeploymentConfig(unittest.TestCase):
    def transform(self, route=None, drift=False, limits=()):
        with tempfile.TemporaryDirectory() as temp:
            d = Path(temp)
            env = {"ULYSSE_ANALYSIS_MODE": "hermes-live", "ULYSSE_DB_NAME": "ulysse_stack"}
            worker = {**env, "OPENROUTER_API_KEY": "fake-private-test-key", "AGENT_MODEL_ID": "openai/gpt-4.1-mini",
                      "AGENT_SESSION_ID": "existing-session", "AGENT_RUN_BUDGET_USD": "0.1",
                      "AGENT_SESSION_BUDGET_USD": "1", "AGENT_MONTH_BUDGET_USD": "3"}
            if route:
                worker["AGENT_PROVIDER_ROUTE"] = route
            original = {"name": "ulysse", "services": {
                name: {"image": f"old-{name}", "environment": copy.deepcopy(worker if name == "worker" else env),
                       "volumes": [{"type": "volume", "source": "keep-data", "target": "/data"}]}
                for name in ("api", "worker", "hermes", "model-stub", "db-init", "demo-seed", "postgres", "keycloak")
            }, "volumes": {"keep-data": {"name": "ulysse_keep-data"}}}
            (d / "before.json").write_text(json.dumps(original))
            services = ("api", "worker", "hermes", "model-stub")
            (d / "services.txt").write_text("\n".join(services))
            for name in services:
                running = copy.deepcopy(original["services"][name]["environment"])
                if drift and name == "worker":
                    running["AGENT_SESSION_ID"] = "unexpected-session"
                (d / f"{name}.inspect.json").write_text(json.dumps([{
                    "Image": f"sha256:pinned-{name}", "Config": {"Env": [f"{k}={v}" for k, v in running.items()]}, "Mounts": []}]))
            with patch.object(sys, "argv", ["-", str(d), "test-tag", *limits]):
                exec(compile(TRANSFORM, "deployment-config", "exec"), {})
            return original, json.loads((d / "deploy.json").read_text()), json.loads((d / "rollback.json").read_text())

    def test_cutover_preserves_every_unrelated_setting_and_budget(self):
        original, candidate, rollback = self.transform()
        expected = copy.deepcopy(original)
        for name in ("api", "worker", "db-init", "demo-seed"):
            expected["services"][name]["image"] = "ulysse-app:test-tag"
        for name in ("hermes", "model-stub"):
            expected["services"][name]["image"] = "ulysse-hermes:test-tag"
        expected["services"]["worker"]["environment"].update({
            "AGENT_MODEL_ID": "z-ai/glm-5.3-flash", "AGENT_MODEL_PROFILE_JSON": "", "AGENT_PROVIDER_ROUTE": "openrouter-eu-zdr", "AGENT_STUB_PROVIDER_URL": ""})
        self.assertEqual(candidate, expected)
        for name in ("api", "worker"):
            self.assertEqual(rollback["services"][name]["environment"]["ULYSSE_ANALYSIS_MODE"], "rules")
        self.assertEqual(rollback["services"]["worker"]["environment"]["AGENT_SESSION_ID"], "existing-session")

    def test_existing_european_profile_can_be_restored_without_going_global(self):
        original, candidate, rollback = self.transform("openrouter-eu-zdr")
        self.assertEqual(candidate['services']['worker']['environment'], {
            **original['services']['worker']['environment'], 'AGENT_STUB_PROVIDER_URL': ''})
        self.assertEqual(rollback["services"]["worker"]["environment"]["ULYSSE_ANALYSIS_MODE"], "hermes-live")
        self.assertEqual(rollback["services"]["worker"]["environment"]["AGENT_PROVIDER_ROUTE"], "openrouter-eu-zdr")

    def test_runtime_drift_stops_the_deployment(self):
        with self.assertRaisesRegex(SystemExit, "ecart de configuration"):
            self.transform(drift=True)

    def test_explicit_operating_budgets_change_only_requested_limits_and_keep_rollback(self):
        original, candidate, rollback = self.transform('openrouter-eu-zdr', limits=('2','20','100'))
        expected = copy.deepcopy(original['services']['worker']['environment'])
        expected.update({'AGENT_STUB_PROVIDER_URL': '', 'AGENT_RUN_BUDGET_USD': '2',
                         'AGENT_SESSION_BUDGET_USD': '20', 'AGENT_MONTH_BUDGET_USD': '100'})
        self.assertEqual(candidate['services']['worker']['environment'], expected)
        self.assertEqual(rollback['services']['worker']['environment'], original['services']['worker']['environment'])
        for name in ('postgres','keycloak','api'):
            self.assertEqual(candidate['services'][name]['environment'], original['services'][name]['environment'])

    def test_explicit_budgets_reject_missing_invalid_unordered_and_excessive_values(self):
        for limits in (('2',), ('2','','100'), ('NaN','20','100'), ('Infinity','20','100'),
                       ('0','20','100'), ('-1','20','100'), ('2.01','20','100'),
                       ('2','20.01','100'), ('2','20','100.01'), ('2','1','100')):
            with self.subTest(limits=limits), self.assertRaises(SystemExit):
                self.transform('openrouter-eu-zdr', limits=limits)

    def test_builtin_and_custom_profile_switches_preserve_session_credentials_and_all_other_services(self):
        _, original, _ = self.transform()
        original['services']['worker']['environment']['AGENT_MODEL_PROFILE_JSON'] = 'previous-profile'
        for custom in (False, True):
            with self.subTest(custom=custom), tempfile.TemporaryDirectory() as temp:
                d = Path(temp)
                (d/'rollback.json').write_text(json.dumps(original))
                selector = 'openai/gpt-4.1-mini'
                profile = {'model': 'example/future-model', 'version': 1}
                if custom:
                    path = d/'profile.json'
                    path.write_text(json.dumps(profile))
                    selector = str(path)
                with patch.object(sys, 'argv', ['-', str(d), selector]):
                    exec(compile(MODEL_TRANSFORM, 'model-config', 'exec'), {})
                candidate = json.loads((d/'deploy.json').read_text())
                expected = copy.deepcopy(original)
                expected['services']['worker']['environment'].update({
                    'AGENT_MODEL_ID': profile['model'] if custom else selector,
                    'AGENT_MODEL_PROFILE_JSON': json.dumps(profile, separators=(',', ':')) if custom else ''})
                self.assertEqual(candidate, expected)
                self.assertEqual(json.loads((d/'rollback.json').read_text()), original)

    def test_invalid_profile_file_stops_before_candidate_write(self):
        _, original, _ = self.transform()
        with tempfile.TemporaryDirectory() as temp:
            d = Path(temp)
            (d/'rollback.json').write_text(json.dumps(original))
            path = d/'profile.json'
            path.write_text('not-json')
            with patch.object(sys, 'argv', ['-', str(d), str(path)]), self.assertRaisesRegex(SystemExit, 'profil JSON invalide'):
                exec(compile(MODEL_TRANSFORM, 'model-config', 'exec'), {})
            self.assertFalse((d/'deploy.json').exists())

    def test_fallback_configuration_only_changes_backup_and_keeps_primary_credentials_and_costs(self):
        _, original, _ = self.transform('openrouter-eu-zdr')
        for selector in ('mistralai/mistral-small-2603', 'off'):
            with self.subTest(selector=selector), tempfile.TemporaryDirectory() as temp:
                d = Path(temp)
                (d/'rollback.json').write_text(json.dumps(original))
                with patch.object(sys, 'argv', ['-', str(d), selector, 'fallback']):
                    exec(compile(MODEL_TRANSFORM, 'fallback-config', 'exec'), {})
                expected = copy.deepcopy(original)
                expected['services']['worker']['environment'].update({
                    'AGENT_FALLBACK_MODEL_ID': '' if selector == 'off' else selector,
                    'AGENT_FALLBACK_MODEL_PROFILE_JSON': ''})
                self.assertEqual(json.loads((d/'deploy.json').read_text()), expected)
                self.assertEqual(json.loads((d/'rollback.json').read_text()), original)

    def research_transform(self, mode='brave', permissions=0o600, symlink=False):
        _, original, _ = self.transform('openrouter-eu-zdr')
        with tempfile.TemporaryDirectory() as temp:
            d = Path(temp)
            (d/'rollback.json').write_text(json.dumps(original))
            key = d/'search.key'
            key.write_text('fake-research-key-with-$-literal')
            key.chmod(permissions)
            if symlink:
                link = d/'search-link.key'
                link.symlink_to(key)
                key = link
            captured = io.StringIO()
            with patch.object(sys, 'argv', ['-', str(d), mode, str(key)]), contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
                exec(compile(RESEARCH_TRANSFORM, 'research-config', 'exec'), {})
            self.assertEqual(captured.getvalue(), '')
            self.assertEqual(json.loads((d/'rollback.json').read_text()), original)
            return original, json.loads((d/'deploy.json').read_text())

    def test_research_only_adds_worker_connector_preserving_model_session_and_budgets(self):
        original, candidate = self.research_transform()
        expected = copy.deepcopy(original)
        expected['services']['worker']['environment'].update({
            'RESEARCH_SEARCH_PROVIDER': 'brave', 'RESEARCH_SEARCH_PRICE_USD': '0.005',
            'BRAVE_SEARCH_API_KEY': 'fake-research-key-with-$$-literal'})
        self.assertEqual(candidate, expected)

    def test_research_off_does_not_read_a_private_key(self):
        original, candidate = self.research_transform(mode='off', permissions=0o644)
        expected = copy.deepcopy(original)
        expected['services']['worker']['environment']['RESEARCH_SEARCH_PROVIDER'] = 'none'
        self.assertEqual(candidate, expected)

    def test_research_rejects_public_key_file(self):
        with self.assertRaisesRegex(SystemExit, 'permissions 600 requis'):
            self.research_transform(permissions=0o644)

    def test_research_rejects_key_symlink(self):
        with self.assertRaisesRegex(SystemExit, 'fichier prive regulier'):
            self.research_transform(symlink=True)


if __name__ == "__main__":
    unittest.main()
