@echo off
rem OKLENT BUSINESS - safe update on Windows (Docker Desktop). Run it from the project folder AFTER copying the new files over the old ones.
rem It never uses "down -v": database and images volumes are kept. A backup is taken first.
setlocal
cd /d "%~dp0"
if not exist "backups" mkdir backups
for /f %%i in ('powershell -nologo -command "Get-Date -Format yyyyMMdd-HHmmss"') do set TS=%%i
if exist "db\init\120_bookings_property_management.sql" del /q "db\init\120_bookings_property_management.sql"
echo [1/4] Backup of the current database ...
docker compose exec -T db sh -c "pg_dump -U erpx_owner -Fc erpx > /tmp/pre-update.dump" && docker compose cp db:/tmp/pre-update.dump "backups\pre-update-%TS%.dump" && echo     saved: backups\pre-update-%TS%.dump || echo     (no running database found - fresh install, nothing to back up)
echo [2/4] Rebuilding images from the NEW files (no cache) ...
docker compose build --no-cache || goto :fail
echo [3/4] Starting (the migrate service upgrades the database first) ...
docker compose up -d || goto :fail
echo [4/4] Checking ...
curl.exe -s http://localhost:3100/api/health
echo.
echo Expected: "version":"1.4.9" and "schema":"ok". Then press Ctrl+F5 in the browser (the footer must show v1.4.9).
exit /b 0
:fail
echo UPDATE FAILED - nothing was deleted. Your backup is in the backups folder. Send the messages above.
exit /b 1

