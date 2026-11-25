# CI-only: prints the end of the installed app's log after a failed smoke. Only the desktop and
# Postgres lines: API and web lines can carry the setup code (src/main.ts `log`).
Get-ChildItem $env:APPDATA, $env:LOCALAPPDATA -Recurse -Filter rowcat.log -ErrorAction SilentlyContinue | ForEach-Object {
	"== $($_.FullName)"
	Get-Content $_.FullName | Select-String -Pattern '^\S+ \[(desktop|postgres)\] ' | Select-Object -Last 80 | ForEach-Object { $_.Line }
}
