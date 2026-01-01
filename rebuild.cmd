rd /s /q node_modules
rd /s /q dist
del package-lock.json
cmd /c npm.cmd i
cmd /c npm.cmd outdated
cmd /c npm.cmd run lint
cmd /c npm.cmd run format
cmd /c npm.cmd run build

