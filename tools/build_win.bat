@echo off
rem =====================================================================
rem MusicBox Windows shell - one-click build script
rem   compiler: csc shipped with .NET Framework 4.x (C# 5 only)
rem   output:   dist\windows\MusicBox.exe  (portable, double-click to run)
rem =====================================================================
setlocal
set "ROOT=%~dp0.."
set "CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
set "WV2=%ROOT%\vendor\wv2"
set "SRC=%ROOT%\windows"
set "OUT=%ROOT%\dist\windows"

if not exist "%CSC%" (
  echo [FAIL] csc not found: %CSC%
  exit /b 1
)
if not exist "%SRC%\MainForm.cs" (
  echo [FAIL] sources not found: %SRC%
  exit /b 1
)
if not exist "%OUT%" mkdir "%OUT%" >nul 2>nul

echo [1/4] compiling MusicBox.exe ...
"%CSC%" /noconfig /target:winexe /platform:x64 /optimize+ /warn:4 /utf8output ^
  /win32manifest:"%SRC%\app.manifest" ^
  /win32icon:"%SRC%\app.ico" ^
  /out:"%OUT%\MusicBox.exe" ^
  /reference:System.dll ^
  /reference:System.Core.dll ^
  /reference:System.Drawing.dll ^
  /reference:System.Windows.Forms.dll ^
  /reference:System.Net.Http.dll ^
  /reference:System.Web.Extensions.dll ^
  /reference:"%WV2%\lib\net462\Microsoft.Web.WebView2.Core.dll" ^
  /reference:"%WV2%\lib\net462\Microsoft.Web.WebView2.WinForms.dll" ^
  "%SRC%\Bridge.cs" "%SRC%\Json.cs" "%SRC%\KvStore.cs" "%SRC%\LoginForm.cs" ^
  "%SRC%\MainForm.cs" "%SRC%\Program.cs" "%SRC%\SelfTest.cs" "%SRC%\Sessions.cs" ^
  "%SRC%\AssemblyInfo.cs"
if errorlevel 1 (
  echo [FAIL] compile failed
  exit /b 1
)
if not exist "%OUT%\MusicBox.exe" (
  echo [FAIL] MusicBox.exe not produced
  exit /b 1
)

echo [2/4] copying web assets ...
if exist "%OUT%\web" rmdir /s /q "%OUT%\web"
xcopy "%ROOT%\web" "%OUT%\web\" /E /I /Y /Q >nul
if errorlevel 1 (
  echo [FAIL] copy web failed
  exit /b 1
)

echo [3/4] copying WebView2 runtime files ...
copy /Y "%WV2%\lib\net462\Microsoft.Web.WebView2.Core.dll" "%OUT%\" >nul
copy /Y "%WV2%\lib\net462\Microsoft.Web.WebView2.WinForms.dll" "%OUT%\" >nul
copy /Y "%WV2%\runtimes\win-x64\native\WebView2Loader.dll" "%OUT%\" >nul
for %%F in ("%OUT%\Microsoft.Web.WebView2.Core.dll" "%OUT%\Microsoft.Web.WebView2.WinForms.dll" "%OUT%\WebView2Loader.dll" "%OUT%\web\index.html") do (
  if not exist %%F (
    echo [FAIL] missing: %%F
    exit /b 1
  )
)

echo [4/4] done
echo [OK] %OUT%\MusicBox.exe
for %%F in ("%OUT%\MusicBox.exe") do echo      exe size = %%~zF bytes
echo [OK] web -^> %OUT%\web
exit /b 0
