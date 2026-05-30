import { test, expect } from "vitest";

import { phoneHref, telegramHref, whatsappHref } from "./candidate-card";

test("telegramHref strips leading @ and uses t.me https form", () => {
  expect(telegramHref("@delfin_swim")).toBe("https://t.me/delfin_swim");
});

test("telegramHref appends encoded draft message", () => {
  const href = telegramHref("@x", "привет, как дела?");
  expect(href).toBe("https://t.me/x?text=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82%2C%20%D0%BA%D0%B0%D0%BA%20%D0%B4%D0%B5%D0%BB%D0%B0%3F");
});

test("telegramHref omits text param when no draft", () => {
  expect(telegramHref("x")).toBe("https://t.me/x");
  expect(telegramHref("x", "")).toBe("https://t.me/x");
});

test("whatsappHref reduces number to digits only", () => {
  expect(whatsappHref("+7 747 222 11 00")).toBe("https://wa.me/77472221100");
});

test("whatsappHref appends encoded draft message", () => {
  expect(whatsappHref("+7 700 000 00 00", "hi there")).toBe(
    "https://wa.me/77000000000?text=hi%20there",
  );
});

test("phoneHref keeps leading + and strips formatting", () => {
  expect(phoneHref("+7 701 234 56 78")).toBe("tel:+77012345678");
});
