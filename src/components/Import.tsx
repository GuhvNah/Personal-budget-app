import { useRef, useState } from 'react';
import { accountIdFor, attachCaptures, buildRows, defaultAccountName, type ReviewBatch } from '../lib/importer';
import { newId } from '../lib/id';
import { guessMapping, parseCSV, type CsvMapping } from '../parsers/csv';
import { pdfToPages } from '../parsers/pdfText';
import { PARSERS, parseStatementPages } from '../parsers/registry';
import { ParseError, type ParsedTransaction } from '../parsers/types';
import { useStore } from '../store';
import { CsvMapper, NEW_ACCOUNT } from './CsvMapper';
import { Review } from './Review';
import { Icon } from './ui';

type State =
  | { step: 'pick'; errors: FileError[] }
  | { step: 'working'; message: string }
  | { step: 'csv'; fileName: string; rows: string[][]; mapping: CsvMapping }
  | { step: 'review'; batches: ReviewBatch[]; errors: FileError[] };

interface FileError {
  fileName: string;
  message: string;
}

function friendly(e: unknown): string {
  if (e instanceof ParseError) return e.message;
  console.error(e);
  return `Something went wrong reading this file (${(e as Error)?.message ?? e}).`;
}

export function Import({ onDone }: { onDone(): void }) {
  const store = useStore();
  const [state, setState] = useState<State>({ step: 'pick', errors: [] });
  const pdfInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);

  async function importPdfs(files: File[]) {
    const existing = new Set(store.transactions.map((t) => t.dedupeKey));
    const seen = new Set<string>();
    const batches: ReviewBatch[] = [];
    const errors: FileError[] = [];
    for (const [i, file] of files.entries()) {
      setState({ step: 'working', message: `Reading ${file.name} (${i + 1} of ${files.length})…` });
      try {
        if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
          throw new ParseError("This isn't a PDF file.");
        }
        const pages = await pdfToPages(await file.arrayBuffer());
        const statement = parseStatementPages(pages);
        const id = accountIdFor(statement.account) ?? `unknown-${newId()}`;
        // Only the first batch for a not-yet-saved account carries the new account.
        const known = store.accounts.some((a) => a.id === id) || batches.some((b) => b.accountId === id);
        batches.push({
          fileName: file.name,
          accountId: id,
          newAccount: known
            ? undefined
            : {
                id,
                name: defaultAccountName(statement.account, statement.bankName),
                bsb: statement.account.bsb,
                number: statement.account.number,
                createdAt: Date.now(),
              },
          warnings: statement.warnings,
          rows: buildRows(statement.transactions, id, 'pdf', store, existing, seen),
        });
      } catch (e) {
        errors.push({ fileName: file.name, message: friendly(e) });
      }
    }
    if (batches.length === 0) setState({ step: 'pick', errors });
    else setState({ step: 'review', batches: attachCaptures(batches, store.transactions), errors });
  }

  async function importCsv(file: File) {
    setState({ step: 'working', message: `Reading ${file.name}…` });
    try {
      const rows = parseCSV(await file.text());
      if (rows.length === 0) throw new ParseError('This CSV file is empty.');
      setState({ step: 'csv', fileName: file.name, rows, mapping: guessMapping(rows) });
    } catch (e) {
      setState({ step: 'pick', errors: [{ fileName: file.name, message: friendly(e) }] });
    }
  }

  function csvToReview(fileName: string, txs: ParsedTransaction[], accountId: string, newName: string) {
    const id = accountId === NEW_ACCOUNT ? `csv-${newId()}` : accountId;
    const batch: ReviewBatch = {
      fileName,
      accountId: id,
      newAccount: accountId === NEW_ACCOUNT ? { id, name: newName, createdAt: Date.now() } : undefined,
      warnings: [],
      rows: buildRows(txs, id, 'csv', store, new Set(store.transactions.map((t) => t.dedupeKey)), new Set()),
    };
    setState({ step: 'review', batches: attachCaptures([batch], store.transactions), errors: [] });
  }

  if (state.step === 'working') {
    return (
      <div className="screen center-screen">
        <div className="spinner" aria-hidden="true" />
        <p>{state.message}</p>
      </div>
    );
  }
  if (state.step === 'csv') {
    return (
      <CsvMapper
        fileName={state.fileName}
        rows={state.rows}
        initial={state.mapping}
        onCancel={() => setState({ step: 'pick', errors: [] })}
        onContinue={(txs, acc, name) => csvToReview(state.fileName, txs, acc, name)}
      />
    );
  }
  if (state.step === 'review') {
    return (
      <Review
        initial={state.batches}
        fileErrors={state.errors}
        onCancel={() => setState({ step: 'pick', errors: [] })}
        onSaved={onDone}
      />
    );
  }

  return (
    <div className="screen">
      <h2 className="screen-title">Import</h2>

      {state.errors.map((e) => (
        <div key={e.fileName} className="banner error" role="alert">
          <Icon name="alert" size={20} />
          <div>
            <b>{e.fileName}</b>: {e.message}
          </div>
        </div>
      ))}

      <button className="big-choice" onClick={() => pdfInput.current?.click()}>
        <Icon name="upload" size={32} />
        <span>
          <b>PDF statements</b>
          <small>Choose one or more. Supported: {PARSERS.map((p) => p.name).join(', ')}</small>
        </span>
      </button>
      <button className="big-choice" onClick={() => csvInput.current?.click()}>
        <Icon name="list" size={32} />
        <span>
          <b>CSV file</b>
          <small>From any bank. You'll match up the columns.</small>
        </span>
      </button>

      <p className="hint">
        Files are read on this phone and never uploaded anywhere. Overlapping statements are fine – transactions
        you've already imported are skipped.
      </p>

      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void importPdfs(files);
        }}
      />
      <input
        ref={csvInput}
        type="file"
        accept=".csv,text/csv,text/comma-separated-values,application/vnd.ms-excel"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importCsv(file);
        }}
      />
    </div>
  );
}
