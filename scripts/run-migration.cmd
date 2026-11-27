@echo off
setlocal
pushd "%~dp0.."
call npx.cmd tsx scripts/run-migration.ts %*
set exit_code=%errorlevel%
popd
exit /b %exit_code%
