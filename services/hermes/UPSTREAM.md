# Hermes upstream

Source: https://github.com/NousResearch/hermes-agent

Commit: `e76fb951a1d207c9596032426e7e0eadfb197bea`.

Licence MIT : le checkout officiel, son fichier `LICENSE` et les licences des dépendances sont conservés dans l'image. Aucun fork du moteur. Python 3.14 est le runtime officiellement supporté de cette révision ; le paquet PyPI homonyme n'est pas utilisé. `pm/lock.json` et l'installateur scellé officiels fixent les artefacts et leurs empreintes. La construction échoue si le commit ou un artefact verrouillé n'est pas disponible.

L'adaptateur Ulysse enregistre sept outils dans `tools.registry.registry`, puis impose `enabled_toolsets=['ulysse']` et vérifie `agent.tools` et `agent.valid_tool_names`. Le service crée un sous-processus par run : registres, plugins, caches et sessions ne sont pas partagés entre tenants. Le processus n'a pas accès au réseau public. Son unique accès d'inférence est la passerelle du worker ; les continuations/retries y repassent et sont comptés.

`skip_memory` seul ne supprime pas toute persistance Hermes : l'initialisation crée notamment un répertoire de sessions. Ulysse utilise un `HERMES_HOME` temporaire vide par exécution, sans session DB, trajectories, checkpoints, mémoire ou contexte local ; le répertoire entier est supprimé après succès, erreur ou timeout. Le tmpfs disparaît au redémarrage. Les événements structurés utiles restent dans PostgreSQL. Le service n'enregistre pas les prompts, les messages bruts ni la chaîne de pensée.
