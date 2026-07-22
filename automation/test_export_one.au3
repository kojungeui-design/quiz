; =====================================================================
; 실제 Export 테스트 — 회로 1개(Batt0007)만 자동으로 export
; 전체 자동화가 작동하는지 확인용. 더블클릭으로 실행.
;
; 안전장치:
;  - 시작 전 4초 대기 (중단하려면 이 시간에 스크립트 창/트레이 아이콘 종료)
;  - 각 단계에서 예상 창이 안 뜨면 자동 중단 (엉뚱한 클릭 방지)
;  - 진행 상황을 화면 좌상단에 표시
;
; ※ Batt0007은 화면 맨 위 줄. 진행 중 시험이어도 export는 안전(영상에서 확인).
; =====================================================================

Global $BTS = "BTS-600"
Global $EXPORT_WIN = "Battery - Data export"
Global $CONV_WIN = "Data file conversion"
Global $OUT_DIR = "E:\bts_csv"
Global $fname = $OUT_DIR & "\CIRC0007.csv"

; 좌표 (1920x1080 전체화면 기준)
Global $BATT0007[2] = [55, 202]     ; 메인 그리드 Batt0007 줄
Global $EXPORT[2]   = [810, 278]    ; Export 버튼
Global $DEST[2]     = [180, 565]    ; Destination file 칸
Global $COPY[2]     = [640, 487]    ; Copy 버튼
Global $OK[2]       = [640, 567]    ; Ok 버튼
Global $CANCEL[2]   = [810, 644]    ; Test sections Cancel

Func note($m)
    ToolTip($m, 10, 10)
EndFunc

; 버튼 이름으로 클릭(우선), 실패 시 좌표로 클릭 (좌표 부정확해도 동작)
Func clickBtn($win, $text, $x, $y)
    Local $r = ControlClick($win, "", "[TEXT:" & $text & "]")
    If $r = 0 Then MouseClick("left", $x, $y, 1, 15)
    Return $r
EndFunc
Func stop_($m)
    note("[중단] " & $m)
    Sleep(3000)
    Exit
EndFunc

If Not FileExists($OUT_DIR) Then DirCreate($OUT_DIR)

note("4초 후 시작합니다. 중단하려면 지금 이 스크립트를 종료하세요.")
Sleep(4000)

If Not WinActivate($BTS) Then stop_("BTS-600 창을 찾지 못함")
WinWaitActive($BTS, "", 8)
Sleep(800)

; ① Batt0007 더블클릭 → Test sections
note("① Batt0007 더블클릭 → Test sections 열기")
MouseClick("left", $BATT0007[0], $BATT0007[1], 2, 20)
Sleep(1500)

; ② Export
note("② Export 버튼")
MouseClick("left", $EXPORT[0], $EXPORT[1], 1, 20)
If Not WinWait($EXPORT_WIN, "", 8) Then stop_("Export 창이 안 뜸 — Export 좌표 확인 필요")
WinActivate($EXPORT_WIN)
Sleep(800)

; ③ 파일명 입력
note("③ 파일명 입력: " & $fname)
MouseClick("left", $DEST[0], $DEST[1], 1, 15)
Sleep(400)
Send("{END}")
Send("+{HOME}")
Send("{DEL}")
Sleep(200)
Send($fname, 1)
Sleep(600)

; ④ Copy(대상 확정)
note("④ Copy — 대상 확정")
MouseClick("left", $COPY[0], $COPY[1], 1, 15)
Sleep(800)
; 덮어쓰기 경고 → Yes
If WinWait("[CLASS:#32770]", "", 3) Then
    WinActivate("[CLASS:#32770]")
    ControlClick("[CLASS:#32770]", "", "[TEXT:Yes]")
    Sleep(500)
EndIf

; ⑤ Ok → 변환
note("⑤ Ok — 변환 시작")
MouseClick("left", $OK[0], $OK[1], 1, 15)

; ⑥ 변환 완료 대기
If WinWait($CONV_WIN, "", 8) Then
    note("⑥ 변환 중... 완료까지 대기")
    Local $t = TimerInit()
    While WinExists($CONV_WIN)
        If TimerDiff($t) > 600000 Then stop_("변환 시간초과")
        Sleep(1000)
    WEnd
EndIf

; ⑦ 창 닫기
If WinExists($EXPORT_WIN) Then WinClose($EXPORT_WIN)
Sleep(400)
MouseClick("left", $CANCEL[0], $CANCEL[1], 1, 15)

note("✅ 완료! E:\bts_csv\CIRC0007.csv 파일이 생겼는지 확인하세요.")
Sleep(4000)
