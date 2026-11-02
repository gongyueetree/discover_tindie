# PCB planner adjustments (v13)

- Board width/height now use editable text drafts in number inputs. Empty intermediate values and multi-digit entry do not mutate the document. Enter or blur validates and applies the value; Escape restores the committed value. The existing 20–300 mm bounds remain; decimal sizes are accepted. Rejected sizes retain the current board and display a field-level explanation. Placement/overlap constraints remain active.
- Click the selected component's MPN text or MPN label to open an in-page modal. The existing catalogue lookup supplies exact MPN/manufacturer matches only. The modal includes description, parameters, CAD previews and datasheet/CAD links; loading/failure states are explicit. Escape/Close returns to the unchanged planner, with focus restoration.
- Removed the two inspector status notices for overlap/out-of-board and the following generic footprint notice. The underlying layout validation is preserved.
- Moved BOM and cost estimation into the inspector. The compact BOM retains matching, supplier-price refresh, build quantity, priced subtotal, unpriced count, line details and CSV export. No import/placement controls are shown in this embedded heading. Existing tax/shipping and missing-price explanations remain with the estimate.
- Removed the functional block diagram UI and its download action from the planner. Existing exported board functionality remains unchanged.

Validation: TypeScript, production build and existing Maker regression checks. Browser interaction verification was not completed in this environment.
