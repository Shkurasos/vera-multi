@echo off
set QT_TOOLS=E:\QT\Tools\mingw1310_64
set SRC_DIR=C:\Users\Ярослав\Desktop\Проеты\Vera_Multi\app_desktop
set BUILD_DIR=C:\Users\Ярослав\Desktop\Проеты\Vera_Multi\app_desktop\build

echo [1] Cleaning build directory...
if exist "%BUILD_DIR%" rmdir /S /Q "%BUILD_DIR%" 2>nul

echo [2] Creating build directory...
mkdir "%BUILD_DIR%"

echo [3] Running CMake configuration...
cmake -G "MinGW Makefiles" "%SRC_DIR%" -B "%BUILD_DIR%" ^
  -DCMAKE_C_COMPILER="%QT_TOOLS%\bin\gcc.exe" ^
  -DCMAKE_CXX_COMPILER="%QT_TOOLS%\bin\g++.exe" ^
  -DCMAKE_MAKE_PROGRAM="%QT_TOOLS%\bin\mingw32-make.exe" ^
  -DCMAKE_BUILD_TYPE=Release

if %errorlevel% neq 0 (
    echo CMake configuration failed!
    pause
    exit /b 1
)

echo [4] Building...
"%QT_TOOLS%\bin\mingw32-make.exe" -C "%BUILD_DIR%" --config Release

if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b 1
)

echo [5] Running application...
"%BUILD_DIR%\Release\Vera_Multi_CPP.exe"

pause