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

; ── 로그인 (매일 아침 재부팅 후 BTS가 뜨면 로그인 창이 먼저 나옴) ──
Global $LOGIN_WIN = "System access"
Global $LOGIN_ID = "Digatron"
Global $LOGIN_PW = "bts600"
Global $LOGIN_OPERATOR[2] = [1023, 361]   ; Operator 입력칸
Global $LOGIN_PASSWORD[2] = [1023, 387]   ; Password 입력칸
Global $LOGIN_OK[2] = [861, 428]          ; Ok 버튼

Global $BTS = "BTS-600"
Global $EXPORT_WIN = "Battery - Data export"
Global $TESTSEC_WIN = "Battery - Test sections"
Global $CONV_WIN = "Data file conversion"
Global $CONV_WIN2 = "Please wait!"      ; 실제 변환창 제목(2026-07-30 스크린샷 확인)
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

; ── 대기시간 (초) ──
Global $WAIT_OPEN = 60      ; Test sections / Export 창 뜰 때까지 (1분)
Global $WAIT_CONV = 120     ; 변환(CSV 생성) 한도(초) — 넘으면 취소하고 건너뜀
;   30초로 두면 mf126#4(2.3MB) 같은 대용량이 잘림. 2분이면 대부분 통과하고,
;   정말 오래 걸리는 것만 건너뛴다. 더 빨리 넘기려면 이 숫자를 줄이면 됨.

Func note($m)
    ToolTip($m, 10, 10)
EndFunc
Func log_($m)
    FileWriteLine($LOG, @HOUR & ":" & @MIN & ":" & @SEC & "  " & $m)
EndFunc
Func clickBtn($win, $t, $x, $y)
    If ControlClick($win, "", "[TEXT:" & $t & "]") = 0 Then MouseClick("left", $x, $y, 1, 15)
EndFunc

; 로그인 창(System access)이 떠 있으면 ID/PW 입력하고 Ok
; 반환: 로그인을 수행했으면 True
Func doLogin()
    If Not WinExists($LOGIN_WIN) Then Return False
    log_("로그인 창 감지 → 자동 로그인 시도")
    WinActivate($LOGIN_WIN)
    Sleep(600)

    ; Operator 칸: 클릭 → 기존 내용 지우고 입력
    MouseClick("left", $LOGIN_OPERATOR[0], $LOGIN_OPERATOR[1], 1, 15)
    Sleep(250)
    Send("{END}")
    Send("+{HOME}")
    Send("{DEL}")
    Sleep(150)
    Send($LOGIN_ID, 1)
    Sleep(250)

    ; Password 칸
    MouseClick("left", $LOGIN_PASSWORD[0], $LOGIN_PASSWORD[1], 1, 15)
    Sleep(250)
    Send("{END}")
    Send("+{HOME}")
    Send("{DEL}")
    Sleep(150)
    Send($LOGIN_PW, 1)
    Sleep(250)

    ; Ok
    If ControlClick($LOGIN_WIN, "", "[TEXT:Ok]") = 0 Then _
        MouseClick("left", $LOGIN_OK[0], $LOGIN_OK[1], 1, 15)

    ; 창이 닫힐 때까지 대기 (최대 20초)
    Local $t = TimerInit()
    While WinExists($LOGIN_WIN) And TimerDiff($t) < 20000
        Sleep(500)
    WEnd
    If WinExists($LOGIN_WIN) Then
        log_("로그인 실패 — 창이 안 닫힘 (ID/PW 또는 좌표 확인)")
        Return False
    EndIf
    log_("로그인 성공")
    Sleep(1500)
    Return True
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
    doLogin()                  ; 중간에 세션이 풀려 로그인 창이 떴을 때 대비
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

; 이번 export 로 새로 생긴 CSV 찾기 (이름이 잘렸을 때 대비).
; CIRC*.csv(이미 정리된 결과)와 _report.csv 는 제외.
Func findFresh($t)
    Local $list = _FileListToArray($OUT_DIR, "*.csv", 1)
    If @error Then Return ""
    Local $elapsed = TimerDiff($t) / 1000 + 120      ; 이번 시도 중 생긴 파일만
    For $k = 1 To $list[0]
        Local $nm = $list[$k]
        If StringLeft($nm, 4) = "CIRC" Then ContinueLoop
        If StringInStr($nm, "_report") Then ContinueLoop
        Local $full = $OUT_DIR & "\" & $nm
        Local $age = _age_sec($full)
        If $age >= 0 And $age <= $elapsed Then Return $full
    Next
    Return ""
EndFunc

; 파일이 마지막으로 수정된 뒤 지난 초 (실패 시 -1)
Func _age_sec($path)
    Local $m = FileGetTime($path, 0)                 ; [년,월,일,시,분,초]
    If Not IsArray($m) Then Return -1
    Local $ft = _toSec($m[0], $m[1], $m[2], $m[3], $m[4], $m[5])
    Local $nw = _toSec(@YEAR, @MON, @MDAY, @HOUR, @MIN, @SEC)
    Return $nw - $ft
EndFunc

Func _toSec($y, $mo, $d, $h, $mi, $s)
    ; 대략적인 절대초 (같은 날 비교용이면 충분)
    Return ((($y * 12 + $mo) * 31 + $d) * 24 + $h) * 3600 + $mi * 60 + $s
EndFunc

; 현재 '선택된' 회로를 Enter 로 열어 export.
; 반환: "ok"/"none"(안 열림)/"crash"/"fail"/"timeout".  $battID 에 배터리 ID.
Func exportSelected(ByRef $battID)
    $battID = ""
    ; ※ BTSEXP는 옛 DOS 규칙으로 파일명을 8글자로 자른다.
    ;   "TEMP_EXPORT.csv" 로 지정해도 실제로는 "TEMP_EXP.csv" 로 저장됨
    ;   → 처음부터 8글자 이름을 쓴다.
    Local $tmp = $OUT_DIR & "\_TMPEXP.csv"
    FileDelete($tmp)

    WinActivate($BTS)
    Sleep(300)
    Send("{ENTER}")                                  ; 선택 회로 열기 (확인됨)
    If Not WinWait($TESTSEC_WIN, "", $WAIT_OPEN) Then Return "none"
    Sleep(1200)                                      ; 목록 로딩 여유

    MouseClick("left", $EXPORT[0], $EXPORT[1], 1, 20)
    If Not WinWait($EXPORT_WIN, "", $WAIT_OPEN) Then
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
    Sleep(1200)
    Local $ov = WinWait("", "data file exists", 5)
    If $ov <> 0 Then
        ControlClick($ov, "", "[TEXT:Yes]")
        Sleep(400)
    EndIf

    clickBtn($EXPORT_WIN, "Ok", $OK[0], $OK[1])     ; 변환 시작

    Local $t = TimerInit()
    While 1
        If WinExists($ERR_WIN) Then Return "crash"
        ; 변환창("Please wait!" 또는 "Data file conversion")이 닫히고
        ; 파일이 생겼을 때만 완료로 인정 (파일 반쯤 쓴 상태 방지)
        ; 혹시 다른 이름으로 저장됐으면(8글자 절삭 등) 그 파일을 찾아 사용
        If Not WinExists($CONV_WIN) And Not WinExists($CONV_WIN2) Then
            If Not FileExists($tmp) Then
                Local $alt = findFresh($t)
                If $alt <> "" Then
                    FileMove($alt, $tmp, 1)
                    Sleep(300)
                EndIf
            EndIf
            If FileExists($tmp) Then ExitLoop
        EndIf
        If TimerDiff($t) > $WAIT_CONV * 1000 Then
            ; 30초 초과 → 변환창의 Cancel 눌러 취소하고 건너뜀
            If WinExists($CONV_WIN2) Then
                WinActivate($CONV_WIN2)
                If ControlClick($CONV_WIN2, "", "[TEXT:Cancel]") = 0 Then MouseClick("left", 965, 534, 1, 15)
            ElseIf WinExists($CONV_WIN) Then
                WinActivate($CONV_WIN)
                If ControlClick($CONV_WIN, "", "[TEXT:Cancel]") = 0 Then MouseClick("left", 965, 534, 1, 15)
            EndIf
            Sleep(1000)
            FileDelete($tmp)                         ; 반쯤 쓴 파일 정리
            Return "skip"
        EndIf
        Sleep(1000)
    WEnd
    Sleep(1500)                                      ; 파일 쓰기 마무리 여유

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

; 0) BTS 창이 아직 안 떴으면 기다림 (아침 재부팅 직후 대비, 최대 5분)
Local $tw = TimerInit()
While Not WinExists($BTS) And Not WinExists($LOGIN_WIN) And TimerDiff($tw) < 300000
    note("BTS-600 시작 대기 중...")
    Sleep(3000)
WEnd

; 0-1) 로그인 창이 떠 있으면 자동 로그인
If WinExists($LOGIN_WIN) Then
    note("로그인 창 감지 → 자동 로그인 중...")
    doLogin()
EndIf

If Not WinExists($BTS) Then
    log_("BTS-600 창을 찾을 수 없어 종료")
    note("❌ BTS-600 창을 찾을 수 없습니다. 프로그램이 켜져 있는지 확인하세요.")
    Sleep(6000)
    Exit
EndIf

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

Local $okCnt = 0, $failCnt = 0, $skipCnt = 0
Local $prevID = "", $sameCnt = 0, $skipRun = 0
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
        $skipRun = 0
        If $id = $prevID Then
            $sameCnt += 1                         ; 같은 ID 반복 = 목록 끝
        Else
            $sameCnt = 0
            $okCnt += 1
            log_($id & " 성공")
        EndIf
        $prevID = $id
    ElseIf $res = "skip" Then
        $skipCnt += 1
        $skipRun += 1                             ; 30초 초과 → 건너뜀
        log_("변환 " & $WAIT_CONV & "초 초과 → 건너뜀 (연속 " & $skipRun & ")")
        If $skipRun >= 8 Then ExitLoop            ; 연속 8회 스킵 = 목록 끝 부근 안전정지
    ElseIf $res = "none" Then
        $sameCnt += 1                             ; 안 열림(빈 줄/포커스 잃음)
        log_("행 열기 실패(none)")
    Else
        $failCnt += 1
        $skipRun = 0
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

FileDelete($OUT_DIR & "\_TMPEXP.csv")
FileDelete($OUT_DIR & "\TEMP_EXP.csv")       ; 이전 버전 잔재 정리
log_("=== 끝: 성공 " & $okCnt & " / 건너뜀 " & $skipCnt & " / 실패 " & $failCnt & " ===")
note("✅ 전 회로 export 완료! 성공 " & $okCnt & " / 건너뜀(30초 초과) " & $skipCnt & " / 실패 " & $failCnt & @CRLF & "(로그: _all_log.txt)")
Sleep(6000)
