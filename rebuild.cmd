rd /s /q node_modules
rd /s /q dist
cmd /c pnpm.cmd i
cmd /c pnpm.cmd outdated
cmd /c pnpm.cmd run lint
cmd /c pnpm.cmd run format
cmd /c pnpm.cmd run build
cmd /c pnpm.cmd test
