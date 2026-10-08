import { describe, expect, it } from "vitest";
import { parseInvoiceForm } from "./input";

const TODAY = "2026-10-15";
const valid = {
  clientName: "Acme Inc.",
  description: "Logo design",
  amount: "300",
  currency: "USD",
  dueDate: "2026-10-20",
  repeat: "none",
};

describe("parseInvoiceForm", () => {
  it("accepts a one-off invoice", () => {
    expect(parseInvoiceForm(valid, TODAY)).toEqual({
      ok: true,
      data: {
        clientName: "Acme Inc.",
        description: "Logo design",
        amount: "300.00",
        currency: "USD",
        dueDate: "2026-10-20",
        repeat: "none",
      },
    });
  });

  it("allows no due date, and ignores it for recurring invoices", () => {
    expect(parseInvoiceForm({ ...valid, dueDate: "" }, TODAY)).toMatchObject({ ok: true, data: { dueDate: null } });
    expect(parseInvoiceForm({ ...valid, repeat: "weekly" }, TODAY)).toMatchObject({
      ok: true,
      data: { dueDate: null, repeat: "weekly" },
    });
  });

  it("reports every invalid field", () => {
    expect(
      parseInvoiceForm(
        { clientName: "", description: "", amount: "1.500,50", currency: "EUR", dueDate: "2026-10-14", repeat: "daily" },
        TODAY,
      ),
    ).toEqual({
      ok: false,
      errors: {
        clientName: "invoiceForm.error.client",
        description: "invoiceForm.error.description",
        amount: "money.error.format",
        currency: "invoiceForm.error.currency",
        dueDate: "invoiceForm.error.duePast",
        repeat: "invoiceForm.error.repeat",
      },
    });
  });

  it("rejects over-long text and impossible dates", () => {
    expect(
      parseInvoiceForm({ ...valid, clientName: "x".repeat(81), description: "y".repeat(201), dueDate: "2026-02-30" }, TODAY),
    ).toEqual({
      ok: false,
      errors: {
        clientName: "invoiceForm.error.clientLong",
        description: "invoiceForm.error.descriptionLong",
        dueDate: "invoiceForm.error.dueDate",
      },
    });
  });
});
