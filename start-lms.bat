@echo off
setlocal

rem ---------------------------------------------------------------------------
rem  ROFT Learning Management System - start everything
rem
rem  Double-click this file. It checks the database, applies any schema changes,
rem  loads demo data the first time, starts the server, and opens the browser.
rem
rem  Safe to run every day: it never overwrites data you have entered. To wipe
rem  the demo tenants and start fresh, run reset-demo-data.bat instead.
rem ---------------------------------------------------------------------------

cd /d "%~dp0"

echo.
echo   ROFT Learning Management System
echo   ==============================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js is not installed, or is not on the PATH.
  echo.
  echo   Install it with:  winget install -e --id OpenJS.NodeJS.LTS
  echo   then close this window and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist ".env.local" (
  echo   Missing .env.local - the file holding your database password.
  echo.
  echo   Copy .env.example to .env.local and fill it in. The README
  echo   explains each setting.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   [1/5] Installing dependencies. This happens once and takes a minute...
  call npm install --no-fund --no-audit
  if errorlevel 1 goto :failed
) else (
  echo   [1/5] Dependencies present.
)

echo   [2/5] Checking the database...
call npx tsx scripts/ensure-database.mts
if errorlevel 1 goto :failed

echo   [3/5] Applying the schema and security policies...
call npx drizzle-kit push --force >nul 2>&1
if errorlevel 1 (
  echo         Schema update failed. Running it again to show the error:
  call npx drizzle-kit push --force
  goto :failed
)
call npx tsx scripts/apply-policies.ts
if errorlevel 1 goto :failed

echo   [4/5] Checking demo data...
call npx tsx scripts/seed.mts --if-empty
if errorlevel 1 goto :failed

echo   [5/5] Starting the server...
echo.
echo   ---------------------------------------------------------------
echo    Opening:  http://localhost:3000       ROFT's own system
echo.
echo    Demo password for every account:  roft-demo-2026
echo.
echo      roland@roftbusiness.org   You: Platform Owner and Instructor
echo.
echo    Client organisations:
echo      http://acme.localhost:3000              admin@acme.test
echo      http://harbourtraining.localhost:3000   admin@harbour.test
echo.
echo    Leave this window open while you use the system.
echo    Press Ctrl+C here to stop it.
echo   ---------------------------------------------------------------
echo.

rem Give the server a moment to bind the port before the browser opens.
rem `ping` is the delay rather than `timeout`, which aborts with "input
rem redirection is not supported" whenever stdin is not a console.
start "" /b cmd /c "ping -n 5 127.0.0.1 >nul & start "" http://localhost:3000"

call npm run dev

goto :eof

:failed
echo.
echo   Startup stopped because of the error above.
echo.
pause
exit /b 1
