; =====================================================================
; 전 회로 자동 Export — 목록 전체를 돌며 모든 회로를 CSV로
;
; 원리 (현장 확인 사실 기반):
;   · 줄을 클릭해 선택하면 ↓(화살표)로 다음 회로 선택 가능 (확인됨)
;   · 단, Test sections 를 Cancel 로 닫으면 키보드 포커스가 목록에서
;     빠져 ↓ 가 안 먹음 (확인됨) → "선택줄을 다시 한 번 클릭"해서
;     포커스를 되살린 뒤 ↓ → Enter 로 다음 회로를 연다.
;   · 선택이 화면 맨 아래에 닿으면, 이후 ↓ 는 목록만 한 줄씩 올리고
;     선택줄은 항상 '맨 아래 같은 위치'에 고정 → 클릭 좌표 고정.
;
; 흐름:
;   1) 목록 맨 위로 스크롤 → 첫 줄 클릭(선택)
;   2) 첫 화면: Enter → Export → Cancel → 선택줄 클릭(포커스) → ↓ ... 반복
;   3) 화면 아래 도달 후: 같은 좌표(맨 아래 줄)에서 클릭 → ↓ → Enter 반복
;   4) 배터리 ID 가 연속 3회 같으면 = 목록 끝 → 종료
;   · 파일명은 CSV 안 Battery ID 로 자동 지정 → 중복 export 는 덮어쓰기(무해)
;   · BTSEXP 크래시(Application Error) 감지 → 닫고 1회 재시도
;
; ※ 좌표는 1920x1080 전체화면 기준(2026-07-30 보정).
;   안 맞으면 capture_coords.au3 로 재측정:
;   첫 줄(Batt0007 텍스트), 스크롤 ▲ 화살표 두 지점이면 충분.
; =====================================================================
#include <File.au3>

Global $BTS = "BTS-600"
Global $EXPORT_WIN = "Battery - Data export"
Global $TESTSEC_WIN = "Battery - Test sections"
Global $CONV_WIN = "Data file conversion"
Global $ERR_WIN = "Application Error"
Global $OUT_DIR = "E:\bts_csv"
Global $LOG = $OUT_DIR & "\_all_log.txt"

; ── 좌표 (1920x1080) ─────────────────────────────────────────────
Global $BASE_Y = 203, $ROW_H = 16.9, $COL_X = 55   ; 첫 줄 y / 줄 간격 / Battery열 x
Global $NROWS = 33                                  ; 한 화면에 보이는 줄 수
Global $EXPORT[2] = [810, 278], $DEST[2] = [180, 565]
Global $COPY[2] = [640, 487], $OK[2] = [640, 567], $CANCEL[2] = [810, 644]
Global $SCROLL_UP[2] = [1252, 201], $SCROLL_DOWN[2] = [1252, 819]   ; 목록 스크롤 ▲ ▼
Global $MAX_SAME = 3        ; 같은 ID 연속 N회면 끝으로 판단
Global $MAX_STEPS = 200     ; 안전 상한(스크롤 최대 횟수)

Func note($m)
    ToolTip($m, 10, 10)
EndFunc
Func log_($m)
    FileWriteLine($LOG, @HOUR & ":" & @MIN & ":" & @SEC & "  " & $m)
EndFunc
Func clickBtn($win, $t, $x, $y)
    If ControlClick($win, "", "[TEXT:" & $t & "]") = 0 Then MouseClick("left", $x, $y, 1, 15)
EndFunc

Func closeErr()
    If WinExists($ERR_WIN) Then
        WinActivate($ERR_WIN)
        Send("!c")
        Sleep(800)
        If WinExists($ERR_WIN) Then WinClose($ERR_WIN)
        Return True
    EndIf
    Return False
EndFunc

Func returnToMain()
    closeErr()
    If WinExists($EXPORT_WIN) Then
        WinClose($EXPORT_WIN)
        Sleep(500)
    EndIf
    If WinExists($TESTSEC_WIN) Then
        MouseClick("left", $CANCEL[0], $CANCEL[1], 1, 15)
        Sleep(500)
    EndIf
    WinActivate($BTS)
    Sleep(600)
EndFunc

; 현재 '선택된' 회로를 Enter 로 열어 export.
; 반환: "ok"/"none"(안 열림)/"crash"/"fail"/"timeout".  $battID 에 배터리 ID.
Func exportSelected(ByRef $battID)
    $battID = ""
    Local $tmp = $OUT_DIR & "\TEMP_EXPORT.csv"
    FileDelete($tmp)

    WinActivate($BTS)
    Sleep(300)
    Send("{ENTER}")                                  ; 선택 회로 열기 (확인됨)
    If Not WinWait($TESTSEC_WIN, "", 6) Then Return "none"
    Sleep(800)

    MouseClick("left", $EXPORT[0], $EXPORT[1], 1, 20)
    If Not WinWait($EXPORT_WIN, "", 8) Then
        returnToMain()
        Return "fail"
    EndIf
    WinActivate($EXPORT_WIN)
    Sleep(700)

    MouseClick("left", $DEST[0], $DEST[1], 1, 15)   ; 파일명 칸
    Sleep(400)
    Send("{END}")
    Send("+{HOME}")
    Send("{DEL}")
    Sleep(150)
    Send($tmp, 1)
    Sleep(400)

    clickBtn($EXPORT_WIN, "Copy", $COPY[0], $COPY[1])
    Sleep(900)
    Local $ov = WinWait("", "data file exists", 3)
    If $ov <> 0 Then
        ControlClick($ov, "", "[TEXT:Yes]")
        Sleep(400)
    EndIf

    clickBtn($EXPORT_WIN, "Ok", $OK[0], $OK[1])     ; 변환 시작

    Local $t = TimerInit()
    While 1
        If WinExists($ERR_WIN) Then Return "crash"
        If Not WinExists($CONV_WIN) And FileExists($tmp) Then ExitLoop
        If TimerDiff($t) > 900000 Then Return "timeout"
        Sleep(1500)
    WEnd

    ; 내용의 Battery ID 로 최종 파일명 결정
    Local $first = FileReadLine($tmp, 1)
    Local $m = StringRegExp($first, "Batt(\d+)", 1)
    If IsArray($m) Then
        $battID = "Batt" & $m[0]
        Local $dst = $OUT_DIR & "\CIRC" & StringFormat("%04d", Number($m[0])) & ".csv"
        FileDelete($dst)
        FileMove($tmp, $dst, 1)
    Else
        $battID = "UNKNOWN"
    EndIf
    Return "ok"
EndFunc

; 크래시면 1회 재시도 포함
Func exportSelectedRetry(ByRef $battID, $selY)
    Local $res = exportSelected($battID)
    If $res = "crash" Then
        log_("크래시 → 재시도")
        returnToMain()
        Sleep(1500)
        MouseClick("left", $COL_X, Int($selY), 1, 15)   ; 선택 복구
        Sleep(300)
        $res = exportSelected($battID)
    EndIf
    returnToMain()
    Return $res
EndFunc

; ── 실행 ─────────────────────────────────────────────────────────
If Not FileExists($OUT_DIR) Then DirCreate($OUT_DIR)
log_("=== 전 회로 export 시작 ===")
note("전 회로 자동 export — 4초 후 시작. 마우스/키보드 건드리지 마세요!")
Sleep(4000)

WinActivate($BTS)
Sleep(800)

; 1) 목록 맨 위로 (스크롤 ▲ 를 목록 길이만큼 클릭) 후 첫 줄 선택
note("목록 맨 위로 이동 중...")
For $i = 1 To 130
    MouseClick("left", $SCROLL_UP[0], $SCROLL_UP[1], 1, 0)
    Sleep(25)
Next
Sleep(600)
MouseClick("left", $COL_X, $BASE_Y, 1, 15)      ; 첫 줄(Batt0007) 선택 + 포커스
Sleep(400)

Local $okCnt = 0, $failCnt = 0
Local $prevID = "", $sameCnt = 0
Local $i = 0                                     ; 지금까지 ↓ 이동 횟수

While $i < $MAX_STEPS
    ; 현재 선택줄의 화면 y (화면 아래 도달 후엔 맨 아래 고정)
    Local $selRow = $i
    If $selRow > $NROWS - 1 Then $selRow = $NROWS - 1
    Local $selY = $BASE_Y + $ROW_H * $selRow

    Local $id = ""
    note("[" & ($i + 1) & "] export 중...  (완료 " & $okCnt & ", 마지막 " & $prevID & ")")
    Local $res = exportSelectedRetry($id, $selY)

    If $res = "ok" Then
        If $id = $prevID Then
            $sameCnt += 1                         ; 같은 ID 반복 = 목록 끝
        Else
            $sameCnt = 0
            $okCnt += 1
            log_($id & " 성공")
        EndIf
        $prevID = $id
    ElseIf $res = "none" Then
        $sameCnt += 1                             ; 안 열림(빈 줄/포커스 잃음)
        log_("행 열기 실패(none)")
    Else
        $failCnt += 1
        log_("실패(" & $res & ") — 계속 진행")
    EndIf
    If $sameCnt >= $MAX_SAME Then ExitLoop

    ; Cancel 로 포커스가 빠졌으므로: 선택줄을 다시 클릭(포커스 복구) → ↓ 다음 회로
    WinActivate($BTS)
    Sleep(300)
    MouseClick("left", $COL_X, Int($selY), 1, 15)
    Sleep(300)
    Send("{DOWN}")
    Sleep(400)
    $i += 1
WEnd

FileDelete($OUT_DIR & "\TEMP_EXPORT.csv")
log_("=== 끝: 성공 " & $okCnt & " / 실패 " & $failCnt & " ===")
note("✅ 전 회로 export 완료! 성공 " & $okCnt & " / 실패 " & $failCnt & @CRLF & "(로그: _all_log.txt)")
Sleep(6000)
