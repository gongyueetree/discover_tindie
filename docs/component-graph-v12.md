# Family-level relationships (v12)

Home and Components retain their embedded previews and full-graph modal. Nodes now aggregate by a deterministic family resolver before ranking or calculating co-occurrence. Supported conventional STM32 product-line names (for example STM32G031K8T6, STM32G031G8U6 and STM32G031F6P6) resolve to STM32G031. STM32G030 remains separate. ST/STMicroelectronics aliases resolve consistently; explicit different manufacturers are not merged. Unrecognized model names retain exact identities. The resolver is deliberately not a general-purpose suffix truncation algorithm.

Naming reference: ST STM32G031 ordering information: https://www.st.com/resource/en/datasheet/stm32g031g8.pdf . The family resolver does not decode electrical specifications or assert that arbitrary syntactically matching ordering codes are available products.

Each family counts distinct catalogue projects once regardless of number of variant MPNs, duplicate BOM rows or design records within the same project. Each variant retains its original identifier, provenance, BOM footprints, available package fields and source project links. Family co-occurrence counts and Jaccard use family-level sets, with no intra-family self-edges. An MPN-focused graph queries the recognized family rather than only the specific ordering code.

Selecting a family shows a horizontally scrollable MPN comparison table on the right. Its rows combine observed BOM variants and real results from the existing component search (eelib/ezPLM, and configured supplier providers), filtered by the same family resolver and manufacturer. Observed BOM rows remain visible if catalogue loading fails. Differences use actual catalogue parameter fields; up to eight differing/relevant fields are displayed alongside package, BOM footprint and project count. Missing fields are explicit and are not guessed from part-number suffixes. No fabricated catalogue variants are inserted. Catalogue matches are not included in graph frequency counts unless observed in a source BOM.

The table is bounded by the existing catalogue search response; it is not an exhaustive manufacturer ordering list. Unknown-family rows stay separate until supported by explicit family metadata or a reviewed rule. The graph retains the previous 24-design reading bound and scope labels.

MPN links use the Components page's exact-selection mode and include a catalogue part id when available. If the exact MPN is absent, the page reports that and does not silently select a similar part. Normal keyword search continues working.

Verification: TypeScript; production build; existing Maker checks; family aggregation tests for variant/project deduplication, footprint provenance, ST aliases, incompatible manufacturer separation, adjacent product-line separation, focused selection, no self-edges and Jaccard. Browser visual/click verification remains pending.
