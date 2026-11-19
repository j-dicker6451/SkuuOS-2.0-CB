export type SpikeReportLine = { section: string; message: string };

export function createReporter(onLine?: (line: SpikeReportLine) => void) {
  const report: SpikeReportLine[] = [];
  const note = (section: string, message: string) => {
    const line = { section, message };
    report.push(line);
    process.stdout.write(`[${section}] ${message}\n`);
    onLine?.(line);
  };
  return { report, note };
}