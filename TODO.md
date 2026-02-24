# TODO for LCYT Project


## LCYT
[ ] make python package also have the stderr silencing

## LCYT-CLI

## LCYT-BACKEND

## LCYT-MCP
[ ] add heartbeat to the description of get_status
[ ] get status should automatically do the sync
[ ] in addition to { text:xxx, timestamp:xxx }, we should also have { text:xxx, time:yyy }, here time is an offset of current time. this way we can batch captions that happened some time ago, and also take the sync offset into account - I think this should be already possible in backend? We'll need to stabilize the offset into a specific type (maybe ms?) so that both python and node versions use the same and the API is stable

## LCYT-WEB

## General
[ ] move plan_* and todo_* to docs/
[ ] update CLAUDE.md
