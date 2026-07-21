; =====================================================================
; BTS-600 일일 Export 자동화 (AutoIt) — 경로 2
; Test sections 창의 Export 버튼을 자동 클릭해 40개 회로 CSV 저장.
;
; ※ 이 스크립트는 '초안'입니다. Export 버튼을 누른 뒤 뜨는
;    대화상자(형식/파일명/경로) 화면을 확인하면 [TODO] 부분을 확정합니다.
;    화면 좌표/컨트롤 ID는 실제 PC 해상도에 맞춰 조정 필요.
; =====================================================================

; ---- 설정 ----
Global $OUT_DIR = "C:\bts_csv"          ; CSV 저장 폴더 (매일 비우고 새로 채움)
Global $BTS_TITLE = "BTS-600"           ; BTS-600 메인 창 제목 일부
Global $N_CIRCUITS = 40                 ; 회로 수

; 출력 폴더 준비 (전날 파일 정리)
If Not FileExists($OUT_DIR) Then DirCreate($OUT_DIR)

; ---- BTS-600 창 활성화 ----
If Not WinExists($BTS_TITLE) Then
    ; 실행돼 있지 않으면 실행 (경로는 실제 설치 위치로)
    Run("C:\BTS-600\bts600.exe")
    WinWait($BTS_TITLE, "", 60)
EndIf
WinActivate($BTS_TITLE)
WinWaitActive($BTS_TITLE, "", 15)
Sleep(1000)

; ---- Test sections 창 열기 ----
; [TODO] 메인 화면에서 배터리 목록 → Test sections 창을 여는 클릭/메뉴 확정
;        (스크린샷상 상단 아이콘 또는 배터리 더블클릭으로 진입)

; ---- 회로별 반복 Export ----
For $i = 1 To $N_CIRCUITS
    ; 1) i번째 배터리(회로) 선택
    ;    [TODO] 배터리 목록에서 BATT00NN 선택 방법 확정
    ;           (예: 목록 항목 클릭 좌표 또는 키보드 방향키 이동)

    ; 2) 해당 배터리의 '진행 중/최신' 시험구간(test section) 선택
    ;    [TODO] Test sections 리스트에서 대상 행 선택 확정

    ; 3) Export 버튼 클릭
    ;    Test sections 창의 Export 버튼 (스크린샷에서 확인됨)
    ;    [TODO] 버튼 컨트롤 ID 또는 좌표 확정
    ; ControlClick($BTS_TITLE, "", "[TEXT:Export]")

    ; 4) Export 대화상자 처리
    ;    [TODO] === 여기가 핵심. Export 클릭 후 뜨는 창을 확인해야 함 ===
    ;    - 출력 형식(ASCII/CSV) 선택
    ;    - 파일명 입력 (권장: 회로번호로 = Circ00NN.csv 로 저장해 구분)
    ;    - 저장 경로를 $OUT_DIR 로 지정
    ;    - 확인/저장 클릭
    ;    예시 골격:
    ;    WinWaitActive("Export", "", 10)
    ;    ControlSetText("Export", "", "Edit1", $OUT_DIR & "\Circ" & StringFormat("%04d", $i) & ".csv")
    ;    ControlClick("Export", "", "[TEXT:OK]")

    Sleep(500)
Next

; 완료 로그
FileWriteLine($OUT_DIR & "\_export_log.txt", @YEAR & "-" & @MON & "-" & @MDAY & " " & @HOUR & ":" & @MIN & "  export 완료")

; 이후 run_daily.bat 이 daily_report.py 를 이어서 실행함
