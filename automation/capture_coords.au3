; =====================================================================
; 좌표 캡처 도구 (안전) — Finder Tool 대신 사용
;
; 프로그램 속을 건드리지 않고 '마우스 위치'만 읽으므로 BTS-600이 죽지 않는다.
; 사용법:
;   1) 이 스크립트를 실행 (더블클릭)
;   2) BTS-600에서 각 위치에 마우스를 올려놓고, 아래 단축키를 누른다
;      → 그 순간의 화면 좌표가 coords.txt 에 저장된다
;   3) 다 하면 F12로 종료. coords.txt 를 나에게 보내주면 스크립트를 완성한다.
;
; ※ 클릭하지 말고 '마우스만 올려놓고 키'를 누르세요. (클릭하면 그 버튼이 눌림)
; =====================================================================

Global $LOG = @ScriptDir & "\coords.txt"
FileDelete($LOG)

HotKeySet("{F1}", "cap_export")     ; Export 버튼
HotKeySet("{F2}", "cap_format")     ; Convert to 드롭다운
HotKeySet("{F3}", "cap_dest")       ; Destination file 입력칸
HotKeySet("{F4}", "cap_ok")         ; Ok 버튼
HotKeySet("{F5}", "cap_battlist")   ; 배터리 목록 (첫 항목 위치)
HotKeySet("{F6}", "cap_section")    ; Test sections 목록 (첫 항목 위치)
HotKeySet("{F7}", "cap_extra1")     ; 여분 1 (필요시)
HotKeySet("{F8}", "cap_extra2")     ; 여분 2
HotKeySet("{F12}", "done")

ToolTip("좌표 캡처 준비됨. 마우스를 올려놓고 F1~F6 누르세요. (F12=종료)", 10, 10)

While 1
    Sleep(100)
WEnd

Func rec($label)
    Local $p = MouseGetPos()
    FileWriteLine($LOG, $label & " = " & $p[0] & ", " & $p[1])
    ToolTip($label & " 저장됨: " & $p[0] & ", " & $p[1], 10, 10)
EndFunc

Func cap_export()   ; F1
    rec("Export버튼")
EndFunc
Func cap_format()   ; F2
    rec("형식드롭다운")
EndFunc
Func cap_dest()     ; F3
    rec("저장경로칸")
EndFunc
Func cap_ok()       ; F4
    rec("Ok버튼")
EndFunc
Func cap_battlist() ; F5
    rec("배터리목록_첫항목")
EndFunc
Func cap_section()  ; F6
    rec("시험목록_첫항목")
EndFunc
Func cap_extra1()   ; F7
    rec("여분1")
EndFunc
Func cap_extra2()   ; F8
    rec("여분2")
EndFunc

Func done()         ; F12
    ToolTip("완료. coords.txt 를 보내주세요.", 10, 10)
    Sleep(1500)
    Exit
EndFunc
