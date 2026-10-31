@echo off
rem OKLENT BUSINESS - one-step update from the downloaded zip.
rem Usage: UPDATE-FROM-ZIP.cmd [path-to-zip] default zip: %~dp0oklent-business-v1_3_9.zip target: C:\oklent-erpx
setlocal
set "ZIP=%~1"
if "%ZIP%"=="" set "ZIP=%~dp0oklent-business-v1_3_9.zip"
set "TARGET=C:\oklent-erpx"
if not exist "%TARGET%\docker-compose.yml" (
  echo Default project folder C:\oklent-erpx was not found.
  set /p "TARGET=Enter the full folder path containing docker-compose.yml: "
)
if not exist "%ZIP%" ( echo ERROR: zip not found: %ZIP% & goto :fail )
if not exist "%TARGET%\docker-compose.yml" ( echo ERROR: %TARGET% is not the project folder & goto :fail )
set "TMPD=%TEMP%\oklent-update-%RANDOM%"
mkdir "%TMPD%" || goto :fail
echo [1/5] Extracting %ZIP% ...
tar -xf "%ZIP%" -C "%TMPD%" || ( echo ERROR: extraction failed & goto :fail )
if not exist "%TMPD%\app\api\src\version.js" ( echo ERROR: unexpected zip layout - app\api\src\version.js not found & goto :fail )
findstr /c:"1.3.9" "%TMPD%\app\api\src\version.js" >nul || ( echo ERROR: this zip is NOT version 1.3.9 & goto :fail )
echo [2/5] Copying updated files over %TARGET% (your .env is kept) ...
robocopy "%TMPD%\app" "%TARGET%" /E /XF .env /XD node_modules backups /NFL /NDL /NJH /NJS
if errorlevel 8 ( echo ERROR: copy failed & goto :fail )
findstr /c:"1.3.9" "%TARGET%\api\src\version.js" >nul || ( echo ERROR: files were NOT updated & goto :fail )
if exist "%TARGET%\db\init\120_bookings_property_management.sql" del /q "%TARGET%\db\init\120_bookings_property_management.sql"
rd /s /q "%TMPD%" 2>nul
cd /d "%TARGET%"
echo [3/5] Running safe backup, rebuild and startup ...
call UPDATE-WINDOWS.cmd
exit /b %errorlevel%
:fail
echo UPDATE STOPPED - no database or volumes were deleted.
exit /b 1