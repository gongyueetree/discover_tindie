<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE eagle SYSTEM "eagle.dtd">
<!-- Authored for EELIB.IO's tests (2026-10-27): a schematic with no board, whose library has a dual op-amp in three gates, a pin header with octagon, long and offset pads, a QFN with an exposed pad, a Qwiic connector and a part with a pad on the bottom copper. -->
<eagle version="9.6.2">
<drawing>
<settings>
<setting alwaysvectorfont="no"/>
</settings>
<grid distance="0.1" unitdist="inch" unit="inch" style="lines" multiple="1" display="no"/>
<layers>
<layer number="1" name="Top" color="4" fill="1" visible="yes" active="yes"/>
<layer number="16" name="Bottom" color="1" fill="1" visible="yes" active="yes"/>
<layer number="21" name="tPlace" color="7" fill="1" visible="yes" active="yes"/>
<layer number="25" name="tNames" color="7" fill="1" visible="yes" active="yes"/>
<layer number="27" name="tValues" color="7" fill="1" visible="yes" active="yes"/>
<layer number="51" name="tDocu" color="7" fill="1" visible="yes" active="yes"/>
<layer number="91" name="Nets" color="2" fill="1" visible="yes" active="yes"/>
<layer number="94" name="Symbols" color="4" fill="1" visible="yes" active="yes"/>
<layer number="95" name="Names" color="7" fill="1" visible="yes" active="yes"/>
<layer number="96" name="Values" color="7" fill="1" visible="yes" active="yes"/>
</layers>
<schematic>
<libraries>
<library name="parts-lib">
<description>&lt;h3&gt;Test parts&lt;/h3&gt; Authored for tests. &lt;b&gt;Licensing:&lt;/b&gt; Creative Commons ShareAlike 4.0 International - https://creativecommons.org/licenses/by-sa/4.0/</description>
<packages>
<package name="SO08">
<smd name="1" x="-1.905" y="-2.6" dx="0.6" dy="2.2" layer="1"/>
<smd name="2" x="-0.635" y="-2.6" dx="0.6" dy="2.2" layer="1"/>
<smd name="3" x="0.635" y="-2.6" dx="0.6" dy="2.2" layer="1"/>
<smd name="4" x="1.905" y="-2.6" dx="0.6" dy="2.2" layer="1"/>
<smd name="5" x="1.905" y="2.6" dx="0.6" dy="2.2" layer="1"/>
<smd name="6" x="0.635" y="2.6" dx="0.6" dy="2.2" layer="1"/>
<smd name="7" x="-0.635" y="2.6" dx="0.6" dy="2.2" layer="1"/>
<smd name="8" x="-1.905" y="2.6" dx="0.6" dy="2.2" layer="1"/>
<wire x1="-2.45" y1="1.95" x2="2.45" y2="1.95" width="0.127" layer="51"/>
<wire x1="2.45" y1="1.95" x2="2.45" y2="-1.95" width="0.127" layer="51"/>
<wire x1="2.45" y1="-1.95" x2="-2.45" y2="-1.95" width="0.127" layer="51"/>
<wire x1="-2.45" y1="-1.95" x2="-2.45" y2="1.95" width="0.127" layer="51"/>
<circle x="-1.9" y="-1.3" radius="0.2" width="0" layer="21"/>
<text x="-2.5" y="3.9" size="1" layer="25">&gt;NAME</text>
<text x="-2.5" y="-4.9" size="1" layer="27">&gt;VALUE</text>
</package>
<package name="1X04_LOCK">
<pad name="1" x="0" y="0" drill="1.016" shape="octagon"/>
<pad name="2" x="2.54" y="0" drill="1.016" diameter="1.8796" shape="long" rot="R90"/>
<pad name="3" x="5.08" y="0" drill="1.016" shape="offset" rot="R90"/>
<pad name="4" x="7.62" y="0" drill="1.016" shape="square"/>
<wire x1="-1.27" y1="1.27" x2="8.89" y2="1.27" width="0.2032" layer="21"/>
<wire x1="8.89" y1="1.27" x2="8.89" y2="-1.27" width="0.2032" layer="21"/>
<wire x1="8.89" y1="-1.27" x2="-1.27" y2="-1.27" width="0.2032" layer="21"/>
<wire x1="-1.27" y1="-1.27" x2="-1.27" y2="1.27" width="0.2032" layer="21"/>
<text x="-1.27" y="1.9" size="1.27" layer="25">&gt;NAME</text>
</package>
<package name="C12345">
<smd name="1" x="-1.45" y="0.75" dx="0.8" dy="0.25" layer="1"/>
<smd name="2" x="-1.45" y="0.25" dx="0.8" dy="0.25" layer="1"/>
<smd name="3" x="-1.45" y="-0.25" dx="0.8" dy="0.25" layer="1"/>
<smd name="4" x="-1.45" y="-0.75" dx="0.8" dy="0.25" layer="1"/>
<smd name="5" x="-0.75" y="-1.45" dx="0.8" dy="0.25" layer="1" rot="R90"/>
<smd name="6" x="-0.25" y="-1.45" dx="0.8" dy="0.25" layer="1" rot="R90"/>
<smd name="7" x="0.25" y="-1.45" dx="0.8" dy="0.25" layer="1" rot="R90"/>
<smd name="8" x="0.75" y="-1.45" dx="0.8" dy="0.25" layer="1" rot="R90"/>
<smd name="9" x="1.45" y="-0.75" dx="0.8" dy="0.25" layer="1"/>
<smd name="10" x="1.45" y="-0.25" dx="0.8" dy="0.25" layer="1"/>
<smd name="11" x="1.45" y="0.25" dx="0.8" dy="0.25" layer="1"/>
<smd name="12" x="1.45" y="0.75" dx="0.8" dy="0.25" layer="1"/>
<smd name="13" x="0.75" y="1.45" dx="0.8" dy="0.25" layer="1" rot="R90"/>
<smd name="14" x="0.25" y="1.45" dx="0.8" dy="0.25" layer="1" rot="R90"/>
<smd name="15" x="-0.25" y="1.45" dx="0.8" dy="0.25" layer="1" rot="R90"/>
<smd name="16" x="-0.75" y="1.45" dx="0.8" dy="0.25" layer="1" rot="R90"/>
<smd name="EP" x="0" y="0" dx="1.7" dy="1.7" layer="1" roundness="20" cream="no"/>
<wire x1="-1.5" y1="1.5" x2="1.5" y2="1.5" width="0.1" layer="51"/>
<wire x1="1.5" y1="1.5" x2="1.5" y2="-1.5" width="0.1" layer="51"/>
<wire x1="1.5" y1="-1.5" x2="-1.5" y2="-1.5" width="0.1" layer="51"/>
<wire x1="-1.5" y1="-1.5" x2="-1.5" y2="1.5" width="0.1" layer="51"/>
</package>
<package name="JST04_1MM_RA">
<smd name="1" x="-1.5" y="-2" dx="0.6" dy="1.55" layer="1"/>
<smd name="2" x="-0.5" y="-2" dx="0.6" dy="1.55" layer="1"/>
<smd name="3" x="0.5" y="-2" dx="0.6" dy="1.55" layer="1"/>
<smd name="4" x="1.5" y="-2" dx="0.6" dy="1.55" layer="1"/>
<smd name="NC1" x="-2.8" y="1.875" dx="1.2" dy="1.8" layer="1"/>
<smd name="NC2" x="2.8" y="1.875" dx="1.2" dy="1.8" layer="1"/>
<wire x1="-3" y1="-1" x2="3" y2="-1" width="0.2" layer="21" curve="-20"/>
</package>
<package name="TAG-BOTTOM">
<smd name="1" x="-1" y="0" dx="1" dy="1" layer="16" roundness="100"/>
<smd name="2" x="1" y="0" dx="1.2" dy="0.8" layer="16" roundness="100"/>
</package>
</packages>
<symbols>
<symbol name="OPAMP">
<wire x1="-5.08" y1="5.08" x2="-5.08" y2="-5.08" width="0.4064" layer="94"/>
<wire x1="-5.08" y1="-5.08" x2="5.08" y2="0" width="0.4064" layer="94"/>
<wire x1="5.08" y1="0" x2="-5.08" y2="5.08" width="0.4064" layer="94"/>
<text x="2.54" y="3.175" size="1.778" layer="95">&gt;NAME</text>
<text x="2.54" y="-5.08" size="1.778" layer="96">&gt;VALUE</text>
<pin name="-IN" x="-7.62" y="2.54" visible="pad" length="short" direction="in"/>
<pin name="+IN" x="-7.62" y="-2.54" visible="pad" length="short" direction="in"/>
<pin name="OUT" x="7.62" y="0" visible="pad" length="short" direction="out" rot="R180"/>
</symbol>
<symbol name="PWR+-">
<text x="1.27" y="3.175" size="0.8128" layer="93" rot="R90">V+</text>
<pin name="V+" x="0" y="7.62" visible="pad" length="middle" direction="pwr" rot="R270"/>
<pin name="V-" x="0" y="-7.62" visible="pad" length="middle" direction="pwr" rot="R90"/>
</symbol>
<symbol name="CONN4">
<wire x1="1.27" y1="-5.08" x2="-5.08" y2="-5.08" width="0.4064" layer="94"/>
<wire x1="-5.08" y1="7.62" x2="-5.08" y2="-5.08" width="0.4064" layer="94"/>
<wire x1="-5.08" y1="7.62" x2="1.27" y2="7.62" width="0.4064" layer="94"/>
<wire x1="1.27" y1="-5.08" x2="1.27" y2="7.62" width="0.4064" layer="94" curve="30"/>
<text x="-5.08" y="8.255" size="1.778" layer="95">&gt;NAME</text>
<pin name="1" x="5.08" y="-2.54" visible="pad" length="middle" direction="pas" rot="R180"/>
<pin name="2" x="5.08" y="0" visible="pad" length="middle" direction="pas" rot="R180"/>
<pin name="3" x="5.08" y="2.54" visible="pad" length="middle" direction="pas" rot="R180"/>
<pin name="4" x="5.08" y="5.08" visible="pad" length="middle" direction="pas" rot="R180"/>
</symbol>
<symbol name="BUF">
<rectangle x1="-5.08" y1="-7.62" x2="5.08" y2="7.62" layer="94"/>
<text x="-5.08" y="8.255" size="1.778" layer="95">&gt;NAME</text>
<pin name="CLK" x="-10.16" y="5.08" length="middle" direction="in" function="clk"/>
<pin name="!RST" x="-10.16" y="2.54" length="middle" direction="in" function="dot"/>
<pin name="SDA" x="-10.16" y="0" length="middle"/>
<pin name="INT" x="10.16" y="5.08" length="middle" direction="oc" rot="R180"/>
<pin name="Z" x="10.16" y="2.54" length="middle" direction="hiz" rot="R180"/>
<pin name="VDD" x="10.16" y="0" length="middle" direction="sup" rot="R180"/>
<pin name="NC" x="10.16" y="-2.54" length="middle" direction="nc" rot="R180"/>
<pin name="GND" x="0" y="-12.7" length="middle" direction="pwr" rot="R90"/>
</symbol>
<symbol name="TAG">
<circle x="0" y="0" radius="1.27" width="0.254" layer="94"/>
<pin name="P" x="-5.08" y="0" visible="off" length="short" direction="pas"/>
</symbol>
</symbols>
<devicesets>
<deviceset name="LM358" prefix="U">
<description>&lt;b&gt;Dual op-amp&lt;/b&gt;</description>
<gates>
<gate name="A" symbol="OPAMP" x="0" y="0"/>
<gate name="B" symbol="OPAMP" x="0" y="-15.24"/>
<gate name="P" symbol="PWR+-" x="10.16" y="0" addlevel="request"/>
</gates>
<devices>
<device name="D" package="SO08">
<connects>
<connect gate="A" pin="-IN" pad="2"/>
<connect gate="A" pin="+IN" pad="3"/>
<connect gate="A" pin="OUT" pad="1"/>
<connect gate="B" pin="-IN" pad="6"/>
<connect gate="B" pin="+IN" pad="5"/>
<connect gate="B" pin="OUT" pad="7"/>
<connect gate="P" pin="V+" pad="8"/>
<connect gate="P" pin="V-" pad="4"/>
</connects>
<technologies>
<technology name=""/>
</technologies>
</device>
</devices>
</deviceset>
<deviceset name="CONN_04" prefix="J">
<gates>
<gate name="G$1" symbol="CONN4" x="0" y="0"/>
</gates>
<devices>
<device name="LOCK" package="1X04_LOCK">
<connects>
<connect gate="G$1" pin="1" pad="1"/>
<connect gate="G$1" pin="2" pad="2"/>
<connect gate="G$1" pin="3" pad="3"/>
<connect gate="G$1" pin="4" pad="4"/>
</connects>
<technologies>
<technology name=""/>
</technologies>
</device>
<device name="QWIIC" package="JST04_1MM_RA">
<connects>
<connect gate="G$1" pin="1" pad="1"/>
<connect gate="G$1" pin="2" pad="2"/>
<connect gate="G$1" pin="3" pad="3"/>
<connect gate="G$1" pin="4" pad="4"/>
</connects>
<technologies>
<technology name=""/>
</technologies>
</device>
</devices>
</deviceset>
<deviceset name="BUF*" prefix="U">
<gates>
<gate name="G$1" symbol="BUF" x="0" y="0"/>
</gates>
<devices>
<device name="QFN" package="C12345">
<connects>
<connect gate="G$1" pin="CLK" pad="1"/>
<connect gate="G$1" pin="!RST" pad="2"/>
<connect gate="G$1" pin="SDA" pad="3"/>
<connect gate="G$1" pin="INT" pad="4"/>
<connect gate="G$1" pin="Z" pad="5"/>
<connect gate="G$1" pin="VDD" pad="6"/>
<connect gate="G$1" pin="NC" pad="7"/>
<connect gate="G$1" pin="GND" pad="8 9 EP"/>
</connects>
<technologies>
<technology name="16"/>
</technologies>
</device>
</devices>
</deviceset>
<deviceset name="TAG" prefix="TG">
<gates>
<gate name="G$1" symbol="TAG" x="0" y="0"/>
</gates>
<devices>
<device name="" package="TAG-BOTTOM">
<connects>
<connect gate="G$1" pin="P" pad="1 2"/>
</connects>
<technologies>
<technology name=""/>
</technologies>
</device>
</devices>
</deviceset>
</devicesets>
</library>
</libraries>
<attributes/>
<variantdefs/>
<classes>
<class number="0" name="default" width="0" drill="0"/>
</classes>
<parts>
<part name="U1" library="parts-lib" deviceset="LM358" device="D" value="LM358"/>
<part name="J1" library="parts-lib" deviceset="CONN_04" device="LOCK"/>
<part name="J2" library="parts-lib" deviceset="CONN_04" device="QWIIC" value="QWIIC"/>
<part name="U2" library="parts-lib" deviceset="BUF*" device="QFN" technology="16"/>
<part name="TG1" library="parts-lib" deviceset="TAG" device=""/>
</parts>
<sheets>
<sheet>
<plain>
</plain>
<instances>
<instance part="U1" gate="A" x="20.32" y="20.32"/>
<instance part="U1" gate="B" x="20.32" y="0"/>
<instance part="U1" gate="P" x="35.56" y="20.32"/>
<instance part="J1" gate="G$1" x="0" y="20.32"/>
<instance part="J2" gate="G$1" x="0" y="0"/>
<instance part="U2" gate="G$1" x="50.8" y="10.16"/>
<instance part="TG1" gate="G$1" x="50.8" y="-10.16"/>
</instances>
<busses>
</busses>
<nets>
</nets>
</sheet>
</sheets>
</schematic>
</drawing>
</eagle>
