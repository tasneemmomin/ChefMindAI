/**
 * Recipe Serving Scaler Utility
 * Handles proportional ingredient recalculation, fractional quantity formatting,
 * and cautious non-linear scaling for salt and spices without re-calling the AI API.
 */

const NON_LINEAR_SPICE_REGEX =
  /(?:\b(salt|black pepper|white pepper|chili powder|chilli powder|cayenne|garam masala|clove|cinnamon|pinch|to taste)\b)|(नमक|काली मिर्च|लाल मिर्च|गरम मसाला|लौंग|दालचीनी|स्वादानुसार|चुटकी)/i;

/**
 * Format numeric quantity into clean fractional or decimal representation.
 * e.g., 0.5 -> "1/2", 1.25 -> "1 1/4", 2.0 -> "2"
 */
export function formatQuantity(val) {
  if (val === null || val === undefined || isNaN(val)) {
    return "";
  }

  const num = Number(val);
  if (num <= 0) return "0";

  const whole = Math.floor(num);
  const remainder = num - whole;

  if (remainder < 0.03) {
    return whole.toString();
  }
  if (remainder > 0.97) {
    return (whole + 1).toString();
  }

  // Map common fractions
  const fractionMap = [
    { value: 0.125, fraction: "1/8" },
    { value: 0.25, fraction: "1/4" },
    { value: 0.333, fraction: "1/3" },
    { value: 0.5, fraction: "1/2" },
    { value: 0.667, fraction: "2/3" },
    { value: 0.75, fraction: "3/4" },
  ];

  for (const { value, fraction } of fractionMap) {
    if (Math.abs(remainder - value) < 0.05) {
      return whole > 0 ? `${whole} ${fraction}` : fraction;
    }
  }

  // Fallback to max 1 decimal place
  const rounded = Math.round(num * 10) / 10;
  return rounded.toString();
}

/**
 * Checks whether an ingredient is salt, strong spice, or marked "to taste".
 */
export function isNonLinearIngredient(name = "", unit = "") {
  return NON_LINEAR_SPICE_REGEX.test(name) || NON_LINEAR_SPICE_REGEX.test(unit);
}

/**
 * Scales an ingredient proportionally based on the serving scale ratio.
 * @param {Object|string} ingredient - Structured object or legacy string
 * @param {number} scaleRatio - currentServings / baseServings
 */
export function scaleIngredient(ingredient, scaleRatio = 1) {
  const ratio = typeof scaleRatio === "number" && scaleRatio > 0 ? scaleRatio : 1;

  if (!ingredient) {
    return {
      name: "",
      displayQuantity: "",
      unit: "",
      optional: false,
      displayText: "",
      isSpiceCaution: false,
    };
  }

  // Handle structured ingredient object
  if (typeof ingredient === "object" && ingredient !== null) {
    const name = ingredient.name || "";
    const unit = ingredient.unit || "";
    const optional = Boolean(ingredient.optional);
    const rawQty = ingredient.quantity;

    if (rawQty === null || rawQty === undefined || isNaN(rawQty)) {
      const displayText = `${unit ? `${unit} ` : ""}${name}`.trim();
      return {
        name,
        displayQuantity: "",
        unit,
        optional,
        displayText,
        isSpiceCaution: false,
      };
    }

    const baseQty = Number(rawQty);
    const isSpice = isNonLinearIngredient(name, unit);

    let calculatedQty;
    let isSpiceCaution = false;

    if (isSpice && ratio > 1.25) {
      // Non-linear dampening for high-scale spices/salt to prevent ruining dishes
      calculatedQty = baseQty * (1 + (ratio - 1) * 0.65);
      isSpiceCaution = true;
    } else {
      calculatedQty = baseQty * ratio;
    }

    const displayQuantity = formatQuantity(calculatedQty);
    const displayText = `${displayQuantity ? `${displayQuantity} ` : ""}${unit ? `${unit} ` : ""}${name}`.trim();

    return {
      name,
      displayQuantity,
      unit,
      optional,
      displayText,
      isSpiceCaution,
    };
  }

  // Handle legacy string ingredient (e.g. "200 g paneer", "2 onions", "1/2 tsp salt")
  if (typeof ingredient === "string") {
    let trimmed = ingredient.trim();
    // Convert Devanagari numerals to standard digits
    trimmed = trimmed.replace(/[\u0966-\u096F]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0966 + 48));

    const match = trimmed.match(/^([\d]+(?:[./][\d]+)?)\s*([\p{L}\p{M}]+)?\s+(.+)$/u);

    if (match) {
      const rawNum = match[1];
      let num = parseFloat(rawNum);
      if (rawNum.includes("/")) {
        const parts = rawNum.split("/");
        if (parts.length === 2 && parseFloat(parts[1]) !== 0) {
          num = parseFloat(parts[0]) / parseFloat(parts[1]);
        }
      }

      if (!isNaN(num)) {
        const unit = match[2] || "";
        const name = match[3] || "";
        const isSpice = isNonLinearIngredient(name, unit);
        let calculated = num * ratio;
        let isSpiceCaution = false;

        if (isSpice && ratio > 1.25) {
          calculated = num * (1 + (ratio - 1) * 0.65);
          isSpiceCaution = true;
        }

        const displayQuantity = formatQuantity(calculated);
        const displayText = `${displayQuantity} ${unit ? `${unit} ` : ""}${name}`.trim();

        return {
          name,
          displayQuantity,
          unit,
          optional: false,
          displayText,
          isSpiceCaution,
        };
      }
    }

    return {
      name: trimmed,
      displayQuantity: "",
      unit: "",
      optional: false,
      displayText: trimmed,
      isSpiceCaution: false,
    };
  }

  return {
    name: String(ingredient),
    displayQuantity: "",
    unit: "",
    optional: false,
    displayText: String(ingredient),
    isSpiceCaution: false,
  };
}
