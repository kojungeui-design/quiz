@echo off
rem ---------------------------------------------------------------------------
rem  Locate a usable Python and return it in the PY variable.
rem
rem  PURE ASCII on purpose - cmd.exe parses batch files with the console code
rem  page, so Korean text here would be read as mojibake and then executed.
rem
rem  We cannot rely on PATH alone. On this kind of setup the user PATH holds the
rem  literal string "%USERPROFILE%\AppData\Local\Microsoft\WindowsApps" without
rem  being expanded, so a fresh cmd window cannot find python.exe even though
rem  Python is installed and works fine elsewhere.
rem ---------------------------------------------------------------------------
set "PY="

rem 1) Whatever is on PATH, newest launcher first.
for %%C in (py.exe python.exe python3.exe) do call :try_cmd %%C
if defined PY exit /b 0

rem 2) Common install locations, in case PATH is broken.
call :try_path "%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe"
call :try_path "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
call :try_path "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
call :try_path "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
call :try_path "%ProgramFiles%\Python313\python.exe"
call :try_path "%ProgramFiles%\Python312\python.exe"
call :try_path "%ProgramFiles%\Python311\python.exe"
call :try_path "C:\Python313\python.exe"
call :try_path "C:\Python312\python.exe"
if defined PY exit /b 0

rem 3) Last resort: the Windows Store alias folder may hold a versioned name.
for %%F in ("%LOCALAPPDATA%\Microsoft\WindowsApps\python3*.exe") do call :try_path "%%~fF"
if defined PY exit /b 0

exit /b 1

:try_cmd
if defined PY exit /b
where %1 >nul 2>&1
if errorlevel 1 exit /b
rem `where` can find the Store stub that only opens the Store, so really run it.
%1 -c "import sys" >nul 2>&1
if errorlevel 1 exit /b
set "PY=%1"
exit /b

:try_path
if defined PY exit /b
if not exist %1 exit /b
%1 -c "import sys" >nul 2>&1
if errorlevel 1 exit /b
set "PY=%~1"
exit /b
