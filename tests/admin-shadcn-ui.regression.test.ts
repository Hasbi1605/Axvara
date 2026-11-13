import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

// Subsequent section packets remove entries only after migrating their controls.
export const PENDING_MIGRATION = [
  "AdminOverview.tsx", "AgentIntegration.tsx", "ArticleEditor.tsx", "ArticlesManager.tsx", "BannerManager.tsx",
  "BotAutomationManager.tsx", "BroadcastManager.tsx", "BulkMarkupToolbar.tsx", "BulkTierEditor.tsx", "CategoryManager.tsx",
  "FulfillmentInventoryPanel.tsx", "ImageDropzone.tsx", "NewsletterSubscribers.tsx", "OrderAccessAdmin.tsx",
  "OrdersManager.tsx", "OverviewCharts.tsx", "PaymentMethodsManager.tsx", "PaymentReconciliation.tsx",
  "ProductEditorModal.tsx", "ProofThumbnail.tsx", "ReportExportActions.tsx",
  "StoreSettingsManager.tsx", "VariantEditor.tsx", "WhatsAppNotifications.tsx",
  "sections/CredentialQueue.tsx", "sections/ProductCopyTab.tsx", "sections/ProductVariantRows.tsx", "sections/ProductsSection.tsx",
  "sections/SharedVariantCopyFields.tsx", "sections/SingleVariantFields.tsx", "sections/VariantCopyEditor.tsx", "sections/VariantWarrantyFields.tsx",
].map(file => `src/components/admin/${file}`).concat("src/app/(shop)/admin/page.tsx");

const palette = /(?:text|bg|border|ring|fill|stroke|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d+)?\b/;
function violations(source: string) {
  const lines = source.split("\n");
  const found = new Set<number>();
  const add = (line: number) => { if (!/admin-ui-allow:\s*\S/.test(lines[line])) found.add(line + 1); };
  lines.forEach((line, index) => {
    if (/^\s*(?:\/\/|\*)/.test(line)) return;
    if (palette.test(line) || /[↑↓✓✕✗⚠★•❝↶↷×]/u.test(line)) add(index);
  });
  const file = ts.createSourceFile("admin.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      const attrs = node.attributes.properties;
      const type = attrs.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(file) === "type");
      const allowedInput = tag === "input" && type && ts.isJsxAttribute(type) && type.initializer && ts.isStringLiteral(type.initializer) && /^(file|hidden|range)$/.test(type.initializer.text);
      if (/^(button|select|textarea|input)$/.test(tag) && !allowedInput) add(file.getLineAndCharacterOfPosition(node.getStart(file)).line);
      attrs.forEach(attr => {
        if (ts.isJsxAttribute(attr) && /^(className|style)$/.test(attr.name.getText(file)) && /#[\da-fA-F]{3,8}\b/.test(attr.getText(file))) add(file.getLineAndCharacterOfPosition(attr.getStart(file)).line);
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...found].sort((a, b) => a - b);
}
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? entry.name === "ui" ? [] : files(join(directory, entry.name)) : entry.name.endsWith(".tsx") ? [join(directory, entry.name)] : []);
}
describe("admin shadcn migration ratchet", () => {
  const pending = new Set(PENDING_MIGRATION.map(file => join(file)));
  it.each([...files("src/components/admin"), "src/app/(shop)/admin/page.tsx"].filter(file => !pending.has(file)))("%s uses semantic primitives and tokens", file => {
    expect(violations(readFileSync(file, "utf8")), file).toEqual([]);
  });
  it.each([...pending])("%s still exists and requires migration", file => {
    expect(existsSync(file), file).toBe(true);
    expect(violations(readFileSync(file, "utf8")).length, `Remove migrated file ${file} from PENDING_MIGRATION`).toBeGreaterThan(0);
  });
  it("detects multiline raw controls and styles without exempting adjacent controls", () => {
    expect(violations('<><input type="file" /><button>Bad</button></>')).toEqual([1]);
    expect(violations('<Button style={{\n color: "#abcdef"\n}}>Bad</Button>')).toEqual([1]);
    expect(violations('<Button className="bg-red-500">Bad</Button>')).toEqual([1]);
    expect(violations('<input type="hidden" />')).toEqual([]);
    expect(violations('<button /> // admin-ui-allow: storefront preview')).toEqual([]);
  });
});
