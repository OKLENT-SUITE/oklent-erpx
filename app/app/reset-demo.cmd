@echo off
REM DEMO DATA ONLY: deletes the database volume and rebuilds everything (all data is lost).
echo This DELETES the OKLENT-ERPX demo database. Press Ctrl+C to cancel.
pause
docker compose down -v
docker compose up -d --build
echo Waiting for the API...
timeout /t 15 >nul
docker compose exec -T api node api/src/seed-demo.js
echo Done: http://localhost:3100
