/** Conservative, versioned family rules. No generic suffix stripping. */
export function partFamily(mpn: string, manufacturer = "") {
  const label = mpn.trim().toUpperCase();
  const st =
    !manufacturer.trim() ||
    /^(ST|STMICROELECTRONICS(?:\s*(?:N\.?V\.?|INC\.?))?|意法半导体)$/i.test(
      manufacturer.trim(),
    );
  // STM32 conventional product-line names preserve the three-digit line.
  // Package/memory/temperature/order suffixes are variants, not new nodes.
  const stm =
    st && label.match(/^(STM32[CFGHLUW][0-9]{3})(?:[A-Z0-9]{1,12})?$/);
  if (stm)
    return {
      family: stm[1],
      manufacturer: "STMicroelectronics",
      rule: "STM32 product line",
      grouped: true,
    };
  return {
    family: label,
    manufacturer: manufacturer.trim(),
    rule: "Exact model (no family rule)",
    grouped: false,
  };
}
