@echo off
rem Builds Vera Desktop with Qt 6 (MinGW) and Ninja.
rem The build directory is ASCII-only: CMake/MinGW have trouble with
rem Cyrillic characters in the source path.
setlocal

set "QT_DIR=E:\QT\6.12.0\mingw_64"
set "QT_TOOLS=E:\QT\Tools"
if "%BUILD_ROOT%"=="" set "BUILD_ROOT=C:\Vera_Multi_builds"
if "%BUILD_TYPE%"=="" set "BUILD_TYPE=Release"
set "BUILD_DIR=%BUILD_ROOT%\VeraDesktop"

rem Qt tools (qmlimportscanner) fail on non-ASCII source paths, so the sources
rem are reached through an ASCII junction. The junction only points to the
rem real folder; deleting it does not touch the sources.
set "SRC_DIR=%BUILD_ROOT%\app_desktop_src"
if not exist "%BUILD_ROOT%" mkdir "%BUILD_ROOT%"
if not exist "%SRC_DIR%\CMakeLists.txt" (
  mklink /J "%SRC_DIR%" "%~dp0." >nul
  if errorlevel 1 goto :fail
)

rem Qt's CMake, Ninja and MinGW go first so that other installed copies do not interfere.
set "PATH=%QT_TOOLS%\CMake_64\bin;%QT_TOOLS%\Ninja;%QT_TOOLS%\mingw1310_64\bin;%QT_DIR%\bin;%PATH%"

echo [1/3] Configuring (%BUILD_TYPE%) in %BUILD_DIR%
cmake -S "%SRC_DIR%" -B "%BUILD_DIR%" -G Ninja ^
  -DCMAKE_BUILD_TYPE=%BUILD_TYPE% ^
  -DCMAKE_PREFIX_PATH="%QT_DIR%" ^
  -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++
if errorlevel 1 goto :fail

echo [2/3] Building
cmake --build "%BUILD_DIR%" --parallel
if errorlevel 1 goto :fail

echo [3/3] Deploying Qt runtime
windeployqt --no-translations --qmldir "%SRC_DIR%\qml" "%BUILD_DIR%\VeraDesktop.exe"
if errorlevel 1 goto :fail

echo.
echo Done: %BUILD_DIR%\VeraDesktop.exe
if /I "%~1"=="run" start "" "%BUILD_DIR%\VeraDesktop.exe"
exit /b 0

:fail
echo.
echo Build failed.
exit /b 1