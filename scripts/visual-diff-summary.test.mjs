import assert from "node:assert/strict";
import { test } from "node:test";
import { summarise } from "./visual-diff-summary.mjs";

function report(tests) {
  return {
    suites: [
      {
        title: "visual-regression.spec.ts",
        suites: [
          {
            title: "Chosen frontend at 375 px",
            specs: tests.map(([title, status, message]) => ({
              title,
              tests: [{ status, results: [{ errors: message ? [{ message }] : [] }] }],
            })),
          },
        ],
      },
    ],
  };
}

test("a run where every picture matches says so", () => {
  const text = summarise(report([["home", "expected"]]));
  assert.match(text, /1 screens compared, 0 differ, 0 flaky, 0 skipped/);
  assert.match(text, /Every screen matches its approved picture/);
});

test("each differing screen is listed with the size of its difference", () => {
  const text = summarise(
    report([
      ["home", "expected"],
      [
        "pricing",
        "unexpected",
        "Error: \u001b[2mexpect(\u001b[22mpage).toHaveScreenshot\n  1234 pixels (ratio 0.02 of all image pixels) are different.",
      ],
      [
        "login",
        "unexpected",
        "Expected an image 375px by 812px, received 375px by 900px. 5 pixels (ratio 0.01 of all image pixels) are different.",
      ],
      ["contact", "unexpected", "A snapshot doesn't exist at /x/contact-375-chromium-linux.png"],
      ["register", "skipped"],
    ])
  );
  assert.match(text, /4 screens compared, 3 differ, 0 flaky, 1 skipped/);
  assert.match(text, /\| Chosen frontend at 375 px › pricing \| 1234 pixels differ \|/);
  assert.match(text, /login \| 5 pixels differ \|/);
  assert.match(
    summarise(
      report([["home", "unexpected", "Failed to take two consecutive stable screenshots."]])
    ),
    /home \| the screen kept changing/
  );
  assert.match(text, /contact \| no approved picture \|/);
  assert.doesNotMatch(text, /visual-regression\.spec\.ts ›/);
});

test("a run that compared nothing never reads as a pass", () => {
  const broken = {
    suites: [],
    errors: [{ message: "Error: Process from config.webServer was not able to start." }],
  };
  const text = summarise(broken);
  assert.match(text, /did not complete:\*\* Error: Process from config.webServer/);
  assert.doesNotMatch(text, /Every screen matches/);
  assert.match(summarise({ suites: [] }), /no screen was compared/);
});

test("a page whose size changed is reported as such", () => {
  const text = summarise(
    report([["home", "unexpected", "Expected an image 375px by 812px, received 375px by 900px."]])
  );
  assert.match(text, /page size changed \(375px by 812px approved, 375px by 900px now\)/);
});
