"""Seed a LOCAL ezplm_partdata dev database with test fixtures for Tindie Maker Tools.

Run from an ezplm_partdata checkout, against its local SQLite only (never production):

    cd ezplm_partdata
    set -a; . ./.env.development.example; set +a; unset DATABASE_URL
    .venv/bin/python -m ezplm_pilot.cli ingest --source sample          # 150 sample parts
    .venv/bin/python /path/to/discover_tindie/scripts/dev/seed_partdata_local.py

It adds a few real parts, two REAL open-source designs (tangent3D/z-fighter at a pinned
commit, MIT) whose files the viewer can import from GitHub, one vendor reference design,
and ~40 clearly-named fixture designs ("fixture/…" repos, not openable) so the knowledge
graph has enough co-occurrence to rank. Then it builds a KG snapshot and prints a partner
key / secret for .env.local. Re-running replaces the fixtures.
"""
from __future__ import annotations

import json
import os
import random
import sys

sys.path.insert(0, os.getcwd())  # run from the ezplm_partdata checkout
if not str(os.environ.get("EZPLM_STAGING_DB", "")).startswith("sqlite"):
    sys.exit("Refusing to run: EZPLM_STAGING_DB must point at a local SQLite file.")

from ezplm_pilot import kg, pub_api  # noqa: E402
from ezplm_pilot.ihs import norm_mpn  # noqa: E402
from ezplm_pilot.staging import (  # noqa: E402
    OshwBom, OshwBomModule, OshwItem, OshwMatch, PartnerKey, RepoStat, StagedPart,
)
from ezplm_pilot.web import _new_session  # noqa: E402

CAT_IC = "0191tindie-fixture-ic"
# (mpn, manufacturer, category, description_en, symbol, footprint, datasheet, params)
PARTS = [
    ("CY7C65213-28PVXI", "Infineon Technologies", "USB IC", "USB to UART bridge, full-speed, SSOP-28", "", "SSOP-28_5.3x10.2mm_P0.65mm",
     "https://www.infineon.com/dgdl/Infineon-CY7C65213_USB-Serial_Bridge_Controller-DataSheet.pdf", {"Interface": "USB 2.0 / UART", "Supply Voltage": "3.15 V ~ 5.25 V"}),
    ("MAX202ECDR", "德州仪器", "RS232，RS422，RS485总线接口", "RS-232 dual driver/receiver, 5 V, SOIC-16", "MAX202", "SOIC-16_3.9x9.9mm_P1.27mm",
     "https://www.ti.com/lit/ds/symlink/max202.pdf", {"Drivers/Receivers": "2/2", "Data Rate": "120 kbps"}),
    ("TPS2061CDBVT", "Texas Instruments", "电源开关，配电开关，负载驱动器", "Current-limited power distribution switch, 1 A", "", "SOT-23-5",
     "https://www.ti.com/lit/ds/symlink/tps2061c.pdf", {"Current Limit": "1.5 A", "On-resistance": "96 mΩ"}),
    ("AMS1117-3.3", "Advanced Monolithic Systems", "稳压器 - 线性稳压器控制器", "1 A low dropout regulator, 3.3 V fixed", "AMS1117-3.3", "SOT-223-3_TabPin2",
     "http://www.advanced-monolithic.com/pdf/ds1117.pdf", {"Output Voltage": "3.3 V", "Output Current": "1 A", "Dropout Voltage": "1.3 V"}),
    ("CH340G", "南京沁恒微电子股份有限公司", "USB IC", "USB to serial UART converter", "CH340G", "SOIC-16_3.9x9.9mm_P1.27mm",
     "https://www.wch-ic.com/downloads/CH340DS1_PDF.html", {"Interface": "USB 2.0 / UART"}),
    ("STM32F103C8T6", "意法半导体", "微控制器（MCU）", "Arm Cortex-M3 MCU, 64 KB Flash, 72 MHz, LQFP-48", "STM32F103C8Tx", "LQFP-48_7x7mm_P0.5mm",
     "https://www.st.com/resource/en/datasheet/stm32f103c8.pdf", {"Core": "ARM Cortex-M3", "Flash": "64 KB", "RAM": "20 KB", "Max Frequency": "72 MHz"}),
    ("STM32F103CBT6", "STMicroelectronics", "微控制器（MCU）", "Arm Cortex-M3 MCU, 128 KB Flash, 72 MHz, LQFP-48", "STM32F103CBTx", "LQFP-48_7x7mm_P0.5mm",
     "https://www.st.com/resource/en/datasheet/stm32f103cb.pdf", {"Core": "ARM Cortex-M3", "Flash": "128 KB"}),
    ("ATMEGA328P-AU", "Microchip Technology", "微控制器（MCU）", "8-bit AVR MCU, 32 KB Flash, TQFP-32", "ATmega328P-A", "TQFP-32_7x7mm_P0.8mm",
     "https://ww1.microchip.com/downloads/en/DeviceDoc/ATmega48A-PA-88A-PA-168A-PA-328-P-DS-DS40002061A.pdf", {"Core": "AVR", "Flash": "32 KB"}),
    ("ESP32-S3-WROOM-1-N8R8", "乐鑫信息科技", "无线微控制器（MCU）", "Wi-Fi + Bluetooth LE module, ESP32-S3, 8 MB flash, 8 MB PSRAM", "ESP32-S3-WROOM-1", "ESP32-S3-WROOM-1",
     "https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf", {"Flash": "8 MB", "PSRAM": "8 MB"}),
    ("NE555P", "Texas Instruments", "可编程定时器和振荡器", "Single precision timer, DIP-8", "NE555P", "DIP-8_W7.62mm",
     "https://www.ti.com/lit/ds/symlink/ne555.pdf", {"Supply Voltage": "4.5 V ~ 16 V"}),
    ("LM358DR", "Texas Instruments", "仪器，运算放大器，缓冲器", "Dual operational amplifier, SOIC-8", "LM358", "SOIC-8_3.9x4.9mm_P1.27mm",
     "https://www.ti.com/lit/ds/symlink/lm358.pdf", {"Channels": "2", "GBW": "700 kHz"}),
    ("LM358DT", "STMicroelectronics", "仪器，运算放大器，缓冲器", "Low-power dual operational amplifier", "LM358", "SOIC-8_3.9x4.9mm_P1.27mm", "", {}),
    ("USBLC6-2SC6", "STMicroelectronics", "瞬态电压抑制器（TVS）", "ESD protection for high-speed USB, SOT-23-6", "USBLC6-2SC6", "SOT-23-6", "", {}),
]

# Real public designs (files fetched from GitHub at the pinned commit by the Tindie viewer).
ZF = "tangent3D/z-fighter"
ZF_COMMIT = "e037d5c6ee7a2b4d4341282523836191bc1850df"
REAL = [
    ("fx-zf-usb", "Z-FIGHTER USB Serial / Power Module", "hardware/peripherals/usb_serial_power_module/KiCad",
     [("U1", "CY7C65213-28PVXI"), ("U2", "MAX202ECDR"), ("U3", "TPS2061CDBVT"), ("C1,C2,C3,C4,C5,C6,C7", "CL21B104KBCNNNC"),
      ("R1,R2,R3,R4", "RC0805FR-071KL"), ("J1", "65100516121"), ("J2", "DE-9"), ("D1,D2,D3,D4", "LED")]),
    ("fx-zf-main", "Z-FIGHTER Mainboard", "hardware/mainboard/kicad",
     [("U1", "Z84C0010PEG"), ("U2", "AS6C1008-55PCN"), ("U3", "AT28C256-15PU"), ("U4", "Z84C4010PEG"), ("U5", "74HCT04"), ("U6", "74HCT32"), ("U7", "NE555P"),
      ("Y1", "7.3728MHz")]),
]

FIXTURE_COMBOS = [
    ["STM32F103C8T6", "AMS1117-3.3", "CH340G", "USBLC6-2SC6"],
    ["STM32F103C8T6", "AMS1117-3.3", "USBLC6-2SC6"],
    ["STM32F103CBT6", "AMS1117-3.3", "LM358DR"],
    ["ATMEGA328P-AU", "AMS1117-3.3", "CH340G"],
    ["ATMEGA328P-AU", "CH340G", "NE555P"],
    ["ESP32-S3-WROOM-1-N8R8", "AMS1117-3.3", "USBLC6-2SC6"],
    ["ESP32-S3-WROOM-1-N8R8", "AMS1117-3.3", "CH340G", "LM358DR"],
    ["NE555P", "LM358DR"],
    ["STM32F103C8T6", "LM358DR", "NE555P", "AMS1117-3.3"],
    ["CY7C65213-28PVXI", "MAX202ECDR", "TPS2061CDBVT"],
]
PASSIVES = [("C1,C2", "100nF"), ("R1", "10K"), ("R2,R3", "4.7K"), ("C3", "10uF")]


def main():
    db = _new_session()
    # Clean previous fixtures.
    db.query(OshwMatch).filter(OshwMatch.bom_id.like("fx-%")).delete(synchronize_session=False)
    db.query(OshwBomModule).filter(OshwBomModule.bom_id.like("fx-%")).delete(synchronize_session=False)
    db.query(OshwItem).filter(OshwItem.bom_id.like("fx-%")).delete(synchronize_session=False)
    db.query(OshwBom).filter(OshwBom.bom_id.like("fx-%")).delete(synchronize_session=False)
    db.query(RepoStat).filter(RepoStat.repo.in_([ZF] + [f"fixture/board-{i}" for i in range(60)])).delete(synchronize_session=False)
    db.query(StagedPart).filter(StagedPart.id.like("fx-%")).delete(synchronize_session=False)
    db.commit()

    ids = {}
    for i, (mpn, mfr, cat, den, sym, fp, ds, params) in enumerate(PARTS):
        pid = f"fx-part-{i}"
        ids[norm_mpn(mpn)] = pid
        db.add(StagedPart(id=pid, mpn=mpn, mpn_norm=norm_mpn(mpn), manufacturer=mfr, orig_category_id=CAT_IC, orig_category=cat,
                          description_en=den, orig_symbol=sym or None, orig_footprint=fp or None, new_datasheet=ds or None,
                          new_params_json=json.dumps(params), value_score=50 - i, status="量产"))
    db.commit()

    def add_design(bid, name, items, repo=None, commit=None, subdir=None, stars=None, lic="MIT", vendor_url=None):
        db.add(OshwBom(bom_id=bid, bom_no=bid.upper(), project_id=bid, project_name=name, gh_repo=repo, commit_=commit, subdir=subdir,
                       license=lic, group_lead=True, parse_status="succeeded", stars=stars, eda_tool="KiCad",
                       repo=vendor_url, project_category="TI 参考设计" if vendor_url else None))
        for j, (ref, value) in enumerate(items):
            k = norm_mpn(value)
            item_id = f"{bid}-{j}"
            is_mpn = sum(c.isdigit() for c in k) >= 3
            db.add(OshwItem(item_id=item_id, bom_id=bid, value=value, mpn=value if is_mpn else None, key_norm=k if is_mpn else None,
                            designators=ref, quantity=ref.count(",") + 1, footprint=None))
            if k in ids:
                db.add(OshwMatch(part_id=ids[k], item_id=item_id, bom_id=bid, how="mpn"))

    db.add(RepoStat(repo=ZF, stars=97, license="MIT", description="Z-FIGHTER: a Z80 homebrew computer with peripherals (KiCad)."))
    for bid, name, subdir, items in REAL:
        add_design(bid, name, items, repo=ZF, commit=ZF_COMMIT, subdir=subdir, stars=97)
    add_design("fx-vendor-ti", "TI RS-232 transceiver reference design", [("U1", "MAX202ECDR"), ("U2", "TPS2061CDBVT"), ("U3", "LM358DR"),
               ("U4", "NE555P"), ("C1", "100nF"), ("R1", "10K")], lic="TI 参考设计条款", vendor_url="https://www.ti.com/tool/TIDA-00000")

    rnd = random.Random(7)
    for i in range(40):
        combo = FIXTURE_COMBOS[i % len(FIXTURE_COMBOS)]
        repo = f"fixture/board-{i}"
        stars = rnd.randint(0, 400)
        db.add(RepoStat(repo=repo, stars=stars, license="MIT", description=f"Local test fixture design #{i} (not a real repository)."))
        items = [(f"U{j + 1}", m) for j, m in enumerate(combo)] + PASSIVES
        add_design(f"fx-board-{i}", f"Fixture board {i:02d} · " + " + ".join(m.split("-")[0] for m in combo), items, repo=repo,
                   commit="0" * 40, stars=stars)
    db.commit()

    # Circuit modules per design (normally recognised by partdata's module rules from the BOM).
    MOD = {"STM32F103": "mcu.mcu.arm", "ATMEGA328P": "mcu.mcu.mcu8", "ESP32S3": "mcu.wireless", "AMS1117": "pwr.linear.ldo",
           "CH340G": "wire.usb.uart", "NE555P": "clk.timer", "LM358": "ana.opamp", "USBLC6": "prot.esd",
           "CY7C65213": "wire.usb.uart", "MAX202": "wire.rs232", "TPS2061": "pwr.switch", "Z84C": "logic.retro"}
    for b in db.query(OshwBom).filter(OshwBom.bom_id.like("fx-%")).all():
        mods = set()
        for it in db.query(OshwItem).filter(OshwItem.bom_id == b.bom_id):
            for k, m in MOD.items():
                if (it.key_norm or "").startswith(k.replace("-", "")):
                    mods.add(m)
        for m in mods:
            db.add(OshwBomModule(bom_id=b.bom_id, project_id=b.project_id, module_id=m, n_items=1))
    db.commit()
    print(kg.build(db, log=lambda *a: None, min_pair_family_n=2))
    db.query(PartnerKey).filter(PartnerKey.name == "tindie-local").delete()
    db.commit()
    kid, sec = pub_api.new_key(db, "tindie-local", list(pub_api.SCOPES))
    db.commit()
    print("\nAdd to discover_tindie/.env.local:\n")
    print("PARTDATA_API_BASE=http://127.0.0.1:8080")
    print(f"PARTDATA_API_KEY={kid}")
    print(f"PARTDATA_API_SECRET={sec}")


if __name__ == "__main__":
    main()
