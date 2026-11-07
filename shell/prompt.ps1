# Claude Terminal Assistant: prints a line above the PowerShell prompt that shows whether this
# terminal is the voice target. Dot-sourced from the PowerShell profile by
# scripts/install-prompt.cjs; it wraps whatever prompt function the profile set up before it.
# Kept ASCII-only (the symbols are built from char codes) because Windows PowerShell 5.1 reads
# BOM-less scripts in the ANSI codepage.

$global:__tchNode = (Get-Command node -ErrorAction SilentlyContinue).Source
$global:__tchScript = Join-Path $PSScriptRoot "..\src\statusline.cjs"
$global:__tchPrompt = $function:prompt

function global:prompt {
  $exitCode = $global:LASTEXITCODE
  if ($global:__tchNode) {
    $state = & $global:__tchNode $global:__tchScript --plain 2>$null
    if ($state -eq "selected") {
      # The app's ember accent where the console takes 24-bit color, the nearest console color otherwise.
      if ($Host.UI.SupportsVirtualTerminal) { Write-Host "$([char]27)[38;2;255;122;26m$([char]0x25CF) Selected$([char]27)[0m" }
      else { Write-Host "$([char]0x25CF) Selected" -ForegroundColor DarkYellow }
    }
    else { Write-Host "$([char]0x25CB) Not selected" -ForegroundColor DarkGray }
  }
  $global:LASTEXITCODE = $exitCode # node must not change what the original prompt sees
  & $global:__tchPrompt
}
