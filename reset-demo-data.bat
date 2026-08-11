@echo off
setlocal

rem ---------------------------------------------------------------------------
rem  Deletes the two demo tenants and rebuilds them.
rem
rem  Use this when the demo data has been changed beyond recognition and you
rem  want a clean starting point again.
rem
rem  This destroys everything belonging to the "acme" and "harbourtraining"
rem  tenants, including any courses or learners added to them.
rem ---------------------------------------------------------------------------

cd /d "%~dp0"

echo.
echo   Reset demo data
echo   ===============
echo.
echo   This deletes the Acme Mining Services and Harbour Training Centre
echo   tenants and everything in them, then recreates them fresh.
echo.
echo   Any other tenant is left untouched.
echo.

set /p CONFIRM="  Type YES to continue: "
if /i not "%CONFIRM%"=="YES" (
  echo.
  echo   Cancelled. Nothing was changed.
  echo.
  pause
  exit /b 0
)

echo.
call npx tsx scripts/seed.mts
if errorlevel 1 (
  echo.
  echo   Reset failed. See the error above.
  echo.
  pause
  exit /b 1
)

echo.
pause
