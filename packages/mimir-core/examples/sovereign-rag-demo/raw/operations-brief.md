# Offline Analytics Brief

Example Workspace is a synthetic local knowledge-base deployment used to test Mimir.

The demo goal is to let a test team summarize fictional operational notes without shipping source
files to a hosted RAG service. The approved runtime is a local Linux workstation with an encrypted
disk, local retrieval, and no telemetry.

The initial approval covers three workflows:

- summarize daily operational briefs;
- compare dataset handling notes against internal policy;
- prepare audio briefings only with an offline text-to-speech engine.

The usage review is owned by the Example Review Team. Any remote model endpoint requires a written
exception before use.
