function parseAddressSegments(address = "") {
  return String(address || "")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function buildStaffAddress({ addressLine1, addressLine2, city, address } = {}) {
  const normalizedLine1 = String(addressLine1 || "").trim();
  const normalizedLine2 = String(addressLine2 || "").trim();
  const normalizedCity = String(city || "").trim();
  const normalizedAddress = String(address || "").trim();

  const parts = [normalizedLine1, normalizedLine2, normalizedCity].filter(Boolean);
  if (parts.length) {
    return parts.join(", ");
  }

  return normalizedAddress;
}

function getStaffLocationSummary(staff = {}) {
  const segments = parseAddressSegments(staff.address);
  const structuredLine1 = String(staff.addressLine1 || "").trim();
  const structuredLine2 = String(staff.addressLine2 || "").trim();
  const structuredCity = String(staff.city || "").trim();

  let fallbackLine1 = "";
  let fallbackLine2 = "";
  let fallbackCity = "";
  let fallbackRegion = "";

  if (segments.length === 1) {
    [fallbackLine1] = segments;
  } else if (segments.length === 2) {
    [fallbackLine1, fallbackCity] = segments;
  } else if (segments.length === 3) {
    fallbackLine1 = segments[0] || "";

    if (/\d/.test(segments[1] || "")) {
      fallbackLine2 = segments[1] || "";
      fallbackCity = segments[2] || "";
    } else {
      fallbackCity = segments[1] || "";
      fallbackRegion = segments[2] || "";
    }
  } else if (segments.length >= 4) {
    fallbackLine1 = segments[0] || "";
    fallbackLine2 = segments.slice(1, -2).join(", ");
    fallbackCity = segments[segments.length - 2] || "";
    fallbackRegion = segments[segments.length - 1] || "";
  }

  return {
    addressLine1: structuredLine1 || fallbackLine1,
    addressLine2: structuredLine2 || fallbackLine2,
    city: structuredCity || fallbackCity,
    region: structuredCity ? "" : fallbackRegion,
    address: buildStaffAddress({
      addressLine1: structuredLine1 || fallbackLine1,
      addressLine2: structuredLine2 || fallbackLine2,
      city: structuredCity || fallbackCity,
      address: staff.address,
    }),
  };
}

module.exports = {
  buildStaffAddress,
  getStaffLocationSummary,
};
