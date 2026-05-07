@echo off
title Food Court Git Push Utility
color 0B
cls

echo =========================================================
echo       🚀  FOOD COURT - GITHUB DEPLOYMENT UTILITY  🚀      
echo =========================================================
echo.
echo Current directory: %CD%
echo.

:: Check if git is installed
where git >nul 2>&1
if %ERRORLEVEL% neq 0 (
    color 0C
    echo [ERROR] Git is not installed or not in your PATH.
    echo Please install Git from https://git-scm.com/ and try again.
    goto end
)

:: Display remote repository details
echo [INFO] Remote URL details:
git remote -v
echo.

:: Show active git status
echo ---------------------------------------------------------
echo              CURRENT REPOSITORY STATUS
echo ---------------------------------------------------------
git status
echo ---------------------------------------------------------
echo.

:ask_add
set "ADD_CONFIRM="
set /p ADD_CONFIRM="[?] Do you want to stage (git add .) all changes? (Y/N, default Y): "
if "%ADD_CONFIRM%"=="" set ADD_CONFIRM=Y
if /I "%ADD_CONFIRM%"=="Y" (
    echo.
    echo [+] Staging all changes...
    git add .
    if %ERRORLEVEL% neq 0 (
        color 0C
        echo [ERROR] Failed to stage changes. Please review the errors above.
        goto end
    )
    echo [+] Successfully staged changes!
    echo.
) else (
    echo [-] Skipped staging.
    echo.
)

:commit_section
set "COMMIT_MSG="
set /p COMMIT_MSG="[?] Enter commit message (or press ENTER for default: 'feat: finalize food court premium upgrades'): "
if "%COMMIT_MSG%"=="" set COMMIT_MSG=feat: finalize food court premium upgrades

echo.
echo [+] Committing changes with message: "%COMMIT_MSG%"
git commit -m "%COMMIT_MSG%"
if %ERRORLEVEL% neq 0 (
    echo.
    echo [-] No changes to commit, or commit failed.
) else (
    echo [+] Successfully committed!
)
echo.

:ask_push
set "PUSH_CONFIRM="
set /p PUSH_CONFIRM="[?] Do you want to push to GitHub (git push origin main)? (Y/N, default Y): "
if "%PUSH_CONFIRM%"=="" set PUSH_CONFIRM=Y
if /I "%PUSH_CONFIRM%"=="Y" (
    echo.
    echo [+] Pushing to branch main...
    git push origin main
    if %ERRORLEVEL% neq 0 (
        color 0C
        echo.
        echo [ERROR] Push failed!
        echo.
        echo Possible reasons:
        echo 1. You may need to log in to GitHub in your terminal. Run: 'gh auth login' or enter your personal access token.
        echo 2. There might be remote changes that you need to pull first. Run: 'git pull origin main --rebase'.
        echo.
        goto end
    )
    color 0A
    echo.
    echo =========================================================
    echo       ✨ SUCCESS! YOUR CODE HAS BEEN PUSHED! ✨         
    echo =========================================================
) else (
    echo.
    echo [-] Push skipped. Your changes are committed locally.
)

:end
echo.
echo Press any key to exit...
pause >nul
