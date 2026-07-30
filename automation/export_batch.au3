; =====================================================================
; 배치 자동 Export — 여러 회로를 연속으로 자동 export (진짜 자동화)
; 목록만 주면 사람 손 없이 하나씩 처리. BTSEXP 크래시도 감지·재시도.
;
; 맨 위 $CIRCUITS 에 [회로번호, 행index] 목록을 넣는다.
;   행index: 화면 목록 몇 번째 줄 (Batt0007=0, 0008=1, ... 0015=8, 0016=9)
;   실제 운영에선 '완료 감지'가 이 목록을 만들어 준다.
; =====================================================================

; ← 처리할 회로 목록 (테스트: 3개). [회로번호, 행index]
Global $CIRCUITS[3][2] = [[7, 0], [15, 8], [16, 9]]

Global $BTS = "BTS-600"
Global $EXPORT_WIN = "Battery - Data export"
Global $TESTSEC_WIN = "Battery - Test sections"
Global $CONV_WIN = "Data file conversion"
Global $CONV_WIN2 = "Please wait!"      ; 실제 변환창 제목(스크린샷 확인)
Global $ERR_WIN = "Application Error"
Global $OUT_DIR = "E:\bts_csv"
Global $LOG = $OUT_DIR & "\_batch_log.txt"
; 좌표 영점 (1920x1080 기준, 2026-07-30 전체화면 재보정)
;   Batt0007(첫 줄)=y203, 줄간격 16.9px. COL_X=Battery열 더블클릭 위치.
;   ※ 목록이 '맨 위로 스크롤된 상태' 기준. 해상도 다르면 capture_coords.au3로 재측정.
Global $BASE_Y = 203, $ROW_H = 16.9, $COL_X = 55
Global $EXPORT[2] = [810, 278], $DEST[2] = [180, 565]
Global $COPY[2] = [640, 487], $OK[2] = [640, 567], $CANCEL[2] = [810, 644]

Func note($m)
    ToolTip($m, 10, 10)
EndFunc
Func log_($m)
    FileWriteLine($LOG, @HOUR & ":" & @MIN & ":" & @SEC & "  " & $m)
EndFunc
Func clickBtn($win, $t, $x, $y)
    If ControlClick($win, "", "[TEXT:" & $t & "]") = 0 Then MouseClick("left", $x, $y, 1, 15)
EndFunc

; 크래시창(BTSEXP) 있으면 닫기
Func closeErr()
    If WinExists($ERR_WIN) Then
        WinActivate($ERR_WIN)
        Send("!c")                 ; 닫기(C)
        Sleep(800)
        If WinExists($ERR_WIN) Then WinClose($ERR_WIN)
        Return True
    EndIf
    Return False
EndFunc

; 열린 대화상자 닫고 메인 그리드로 복귀
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
    Sleep(700)
EndFunc

; 회로 1개 export → 결과 "ok"/"crash"/"fail"/"timeout"
Func exportOne($circ, $rowIdx)
    Local $fname = $OUT_DIR & "\CIRC" & StringFormat("%04d", $circ) & ".csv"
    Local $y = Int($BASE_Y + $ROW_H * $rowIdx)

    WinActivate($BTS)
    Sleep(500)
    MouseClick("left", $COL_X, $y, 2, 20)        ; 회로 줄 더블클릭
    Sleep(1500)

    MouseClick("left", $EXPORT[0], $EXPORT[1], 1, 20)   ; Export
    If Not WinWait($EXPORT_WIN, "", 8) Then Return "fail"
    WinActivate($EXPORT_WIN)
    Sleep(700)

    MouseClick("left", $DEST[0], $DEST[1], 1, 15)       ; 파일명
    Sleep(400)
    Send("{END}")
    Send("+{HOME}")
    Send("{DEL}")
    Sleep(150)
    Send($fname, 1)
    Sleep(500)

    clickBtn($EXPORT_WIN, "Copy", $COPY[0], $COPY[1])   ; Copy
    Sleep(900)
    Local $ov = WinWait("", "data file exists", 3)      ; 덮어쓰기?
    If $ov <> 0 Then
        ControlClick($ov, "", "[TEXT:Yes]")
        Sleep(400)
    EndIf

    clickBtn($EXPORT_WIN, "Ok", $OK[0], $OK[1])         ; Ok → 변환

    ; 변환 완료 or 크래시 감지
    Local $t = TimerInit()
    While 1
        If WinExists($ERR_WIN) Then Return "crash"      ; BTSEXP 죽음
        If Not WinExists($CONV_WIN) And Not WinExists($CONV_WIN2) And FileExists($fname) Then ExitLoop  ; 성공
        If TimerDiff($t) > 900000 Then Return "timeout"
        Sleep(1500)
    WEnd

    ; 파일명 보정: 파일 안의 실제 Battery ID로 이름 맞춤 (이름=내용 항상 일치)
    Local $first = FileReadLine($fname, 1)
    Local $m = StringRegExp($first, "Batt(\d+)", 1)
    If IsArray($m) Then
        Local $realName = $OUT_DIR & "\CIRC" & StringFormat("%04d", Number($m[0])) & ".csv"
        If $realName <> $fname Then
            FileMove($fname, $realName, 1)
            log_("파일명 보정: 요청 Circ" & $circ & " → 실제 Batt" & $m[0] & " (행위치 확인필요)")
        EndIf
    EndIf

    Return "ok"
EndFunc

; ── 실행 ──────────────────────────────────────────────
If Not FileExists($OUT_DIR) Then DirCreate($OUT_DIR)
Local $n = UBound($CIRCUITS)
log_("=== 배치 시작 (" & $n & "개) ===")
note("배치 자동 export 시작 — 4초 후 (" & $n & "개 회로). 마우스 건드리지 마세요.")
Sleep(4000)

Local $okCnt = 0, $failCnt = 0
For $i = 0 To $n - 1
    Local $c = $CIRCUITS[$i][0]
    Local $r = $CIRCUITS[$i][1]
    returnToMain()
    note("[" & ($i + 1) & "/" & $n & "] Circ" & StringFormat("%04d", $c) & " export 중...")
    Local $res = exportOne($c, $r)

    ; 크래시면 정리 후 1회 재시도
    If $res = "crash" Then
        log_("Circ" & $c & ": BTSEXP 크래시 → 재시도")
        returnToMain()
        note("Circ" & $c & " 크래시 감지 → 재시도")
        Sleep(1500)
        $res = exportOne($c, $r)
    EndIf

    If $res = "ok" Then
        $okCnt += 1
        log_("Circ" & $c & ": 성공")
    Else
        $failCnt += 1
        log_("Circ" & $c & ": 실패(" & $res & ") — 나중에 수동 확인")
    EndIf
    returnToMain()
Next

log_("=== 배치 끝: 성공 " & $okCnt & " / 실패 " & $failCnt & " ===")
note("✅ 배치 완료! 성공 " & $okCnt & " / 실패 " & $failCnt & "  (로그: _batch_log.txt)")
Sleep(5000)
