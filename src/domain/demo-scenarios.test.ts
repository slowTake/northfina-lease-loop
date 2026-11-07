// Expected values from the data pack, CHALLENGE.md §4 and the calendar rule (D-016), worked by hand.
import { describe, expect, it } from 'vitest';
import {
  loadAssets,
  loadCoefficientTable,
  loadCustomers,
  loadPriceLists,
  loadQuestions,
} from '@/data/load';
import { AS_OF_MAX, parseAsOfDate } from './as-of';
import {
  DEMO_SCENARIOS,
  findStepPreset,
  scenarioHref,
  shiftAsOf,
  type ScenarioStep,
} from './demo-scenarios';
import { answersFromCustomer } from './persona';
import { askedQuestions, validateAnswer } from './question-flow';
import { makeQuote } from './quote';

describe('shiftAsOf', () => {
  it('31 Jan 2026 + 1 month is 28 Feb 2026 (clamped to the month end, D-016)', () => {
    expect(shiftAsOf('2026-01-31', { months: 1 })).toBe('2026-02-28');
  });

  it('5 Nov 2026 + 6 months is 5 May 2027, the first day of month 7 (card 8)', () => {
    expect(shiftAsOf('2026-11-05', { months: 6 })).toBe('2027-05-05');
  });

  it('5 Nov 2026 + 12 months is 5 Nov 2027', () => {
    expect(shiftAsOf('2026-11-05', { months: 12 })).toBe('2027-11-05');
  });

  it('stops at the last allowed demo date, 31 Dec 2035', () => {
    expect(shiftAsOf('2035-06-01', { months: 12 })).toBe(AS_OF_MAX);
  });

  it('only moves forward: Back to today goes the other way', () => {
    expect(() => shiftAsOf('2026-11-05', { months: -1 })).toThrow(RangeError);
  });
});

describe('scenarioHref', () => {
  const asset: ScenarioStep = {
    asOf: '2026-11-05',
    target: { kind: 'asset', assetId: 'ebike-003' },
  };

  it('opens an item page, with the locale first', () => {
    expect(scenarioHref(asset, 'fi')).toBe('/fi/assets/ebike-003');
  });

  it('opens a passport', () => {
    const passport: ScenarioStep = {
      asOf: '2026-11-06',
      target: { kind: 'passport', assetId: 'ebike-008' },
    };
    expect(scenarioHref(passport, 'en')).toBe('/en/assets/ebike-008/passport');
  });

  it('leaves contract and quote targets to the server, which knows their ids', () => {
    const contract: ScenarioStep = {
      asOf: '2027-05-05',
      target: { kind: 'contract', assetId: 'ebike-003', status: 'active' },
    };
    const quote: ScenarioStep = {
      asOf: '2026-11-06',
      target: { kind: 'open_quote', assetId: 'laptop-004' },
    };
    expect(scenarioHref(contract, 'en')).toBeNull();
    expect(scenarioHref(quote, 'en')).toBeNull();
  });
});

describe('DEMO_SCENARIOS', () => {
  const steps = DEMO_SCENARIOS.flatMap((s) => s.steps);

  it('has the 10 cards of CHALLENGE.md §4, each once, in order', () => {
    expect(DEMO_SCENARIOS.map((s) => s.card)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('starts each card on the day its walkthrough needs', () => {
    const dates = Object.fromEntries(
      DEMO_SCENARIOS.map((s) => [s.card, s.steps.map((x) => x.asOf)])
    );
    // Card 2: quote on Thursday (price list 1), sign on Friday (price list 2 from 6 Nov).
    expect(dates[2]).toEqual(['2026-11-05', '2026-11-06']);
    // Card 3: the lease starts 15 Sep 2026, so it runs across the 1 Jan 2027 VAT change.
    expect(dates[3]).toEqual(['2026-09-15']);
    // Card 4: a 31 January start.
    expect(dates[4]).toEqual(['2026-01-31']);
    // Card 6: sent on 5 Nov, signed by the signatory on 20 Nov (D-053).
    expect(dates[6]).toEqual(['2026-11-05', '2026-11-20']);
    // Card 8: month 7 of card 1's lease (5 Nov 2026 start) runs 5 May – 4 Jun 2027.
    expect(dates[8]).toEqual(['2027-05-05']);
  });

  it('names only items that exist in the data pack', async () => {
    const ids = new Set((await loadAssets()).map((a) => a.id));
    for (const step of steps) expect(ids).toContain(step.target.assetId);
  });

  it('names only customers that exist in the data pack', async () => {
    const ids = new Set((await loadCustomers()).map((c) => c.id));
    for (const step of steps) {
      if (step.target.kind === 'contract' && step.target.customerId) {
        expect(ids).toContain(step.target.customerId);
      }
    }
  });

  it('sets only demo dates the app accepts', () => {
    for (const step of steps)
      expect(parseAsOfDate(step.asOf)).toEqual({ ok: true, date: step.asOf });
  });

  it('never carries an expected result: a date, where to go and the inputs to fill (D-059)', () => {
    for (const step of steps) {
      expect(['asOf', 'target', 'preset']).toEqual(expect.arrayContaining(Object.keys(step)));
      const preset = step.preset ?? {};
      expect(['relist', 'quote', 'application']).toEqual(
        expect.arrayContaining(Object.keys(preset))
      );
    }
  });
});

describe('step presets (D-059)', () => {
  const presetSteps = DEMO_SCENARIOS.flatMap((s) =>
    s.steps.map((step, i) => ({ card: s.card, step: i + 1, ...step }))
  ).filter((s) => s.preset);

  it('fills every card that has a form to sign, and leaves the walk-through ones alone', () => {
    // Card 2 quotes on Thursday and applies on Friday; 6.2 is only the signatory's button;
    // 8 and 9 are read and choose on their own pages; 10.2 is the passport.
    expect(presetSteps.map((s) => `${s.card}-${s.step}`)).toEqual([
      '1-1',
      '2-1',
      '2-2',
      '3-1',
      '4-1',
      '5-1',
      '6-1',
      '7-1',
      '10-1',
    ]);
  });

  it('finds a preset by its ?demo=<card>-<step> link', () => {
    expect(findStepPreset('7-1')?.quote).toEqual({ termMonths: 48, downPaymentCents: 2_000_000 });
    expect(findStepPreset('6-2')).toBeNull();
    expect(findStepPreset('11-1')).toBeNull();
    expect(findStepPreset('1-9')).toBeNull();
    expect(findStepPreset('1')).toBeNull();
    expect(findStepPreset(undefined)).toBeNull();
  });

  it('quotes only on terms and down payments the price list accepts that day', async () => {
    const [priceLists, table] = await Promise.all([loadPriceLists(), loadCoefficientTable()]);
    for (const s of presetSteps) {
      // Card 10's re-listed price is set by the re-listing itself, not by a price list (D-035).
      if (!s.preset?.quote || s.preset.relist) continue;
      const made = makeQuote(priceLists, table, {
        assetId: s.target.assetId,
        quoteDate: s.asOf,
        ...s.preset.quote,
      });
      expect(made.ok, `card ${s.card}`).toBe(true);
    }
  });

  it('answers every question the application asks, with answers the rules accept', async () => {
    const [assets, customers, questions, priceLists, table] = await Promise.all([
      loadAssets(),
      loadCustomers(),
      loadQuestions().then((file) => file.questions),
      loadPriceLists(),
      loadCoefficientTable(),
    ]);
    for (const s of presetSteps) {
      const application = s.preset?.application;
      if (!application) continue;
      const customer = customers.find((c) => c.id === application.customerId);
      const asset = assets.find((a) => a.id === s.target.assetId);
      if (!customer || !asset) throw new Error(`card ${s.card}`);
      // Card 2 signs Thursday's 36-month quote. Card 10's re-listed price stands in for its list
      // price: the amount only adds income (from 2 000 €) and PEP (from 10 000 €), both on Aino's
      // record.
      const quote = s.preset?.quote ?? { termMonths: 36, downPaymentCents: 0 };
      const made = makeQuote(priceLists, table, {
        assetId: s.target.assetId,
        quoteDate: s.card === 2 ? '2026-11-05' : s.asOf,
        ...quote,
      });
      if (!made.ok) throw new Error(`card ${s.card}: ${made.reason}`);
      const deal = {
        category: asset.category,
        financedAmountCents: made.quote.financedCents,
        termMonths: quote.termMonths,
      };
      const answers = { ...answersFromCustomer(customer), ...application.answers };
      for (const question of askedQuestions(questions, deal, answers)) {
        const answer = answers[question.id];
        expect(answer, `card ${s.card}: ${question.id}`).toBeDefined();
        expect(validateAnswer(question, answer), `card ${s.card}: ${question.id}`).toMatchObject({
          ok: true,
        });
      }
    }
  });
});
