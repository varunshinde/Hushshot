// Usage: swift pdfkit-check.swift file.pdf "phrase"
// Prints JSON: page count, total text length, whether the phrase is found, and
// the phrase's selection bounds on its page (PDF points). PDFKit is the engine
// macOS Preview uses.
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count >= 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  print("{\"error\":\"cannot open\"}"); exit(1)
}
let text = doc.string ?? ""
var out: [String: Any] = ["pages": doc.pageCount, "chars": text.count, "found": false]
if let sel = doc.findString(args[2], withOptions: []).first, let page = sel.pages.first {
  let b = sel.bounds(for: page)
  out["found"] = true
  out["page"] = doc.index(for: page)
  out["bounds"] = [b.origin.x, b.origin.y, b.size.width, b.size.height]
  out["pageHeight"] = page.bounds(for: .mediaBox).height
}
let data = try! JSONSerialization.data(withJSONObject: out)
print(String(data: data, encoding: .utf8)!)
