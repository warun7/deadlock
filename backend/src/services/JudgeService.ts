import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import {
  Judge0Submission,
  Judge0Response,
  TestCase,
  SubmissionResult,
  TestResult,
  Problem,
  CheckerType,
  CustomRunResult,
} from '../types';
import { checkerService } from './CheckerService';
import { createZipBase64 } from '../utils/zip';
import {
  MULTI_FILE_LANGUAGE_ID,
  batchLanguage,
  buildHarness,
  parseHarnessOutput,
} from './BatchJudge';

/**
 * Judge0 CE language id for Python 3.
 *
 * Problem checkers from the dataset are Python, and they are executed by
 * Judge0 in their own sandbox, independent of whatever language the player
 * submitted in.
 */
const CHECKER_LANGUAGE_ID = 71;

/** Judge0 status ids used below */
const STATUS_TLE = 5;
const STATUS_COMPILE_ERROR = 6;

/** Batch judging hands inputs over as a ZIP; Judge0 extracts at most 10 MB. */
const BATCH_MAX_INPUT_BYTES = 8 * 1024 * 1024;

/** Judge0's defaults, used when /config_info cannot be read */
interface Judge0Limits {
  maxCpu: number;
  maxWall: number;
  maxFileSize: number;
  maxStack: number;
}
const DEFAULT_LIMITS: Judge0Limits = { maxCpu: 15, maxWall: 20, maxFileSize: 4096, maxStack: 128000 };

/**
 * JudgeService - Handles code execution via Judge0 API
 * 
 * This service is non-blocking and async.
 * It submits code to Judge0 and returns the results.
 * 
 * For problems with multiple valid answers, it uses CheckerService
 * instead of Judge0's built-in comparison.
 */
export class JudgeService {
  private client: AxiosInstance;
  
  constructor() {
    this.client = axios.create({
      baseURL: config.judge0.url,
      // Covers compile + run of a whole batch (Judge0 caps each at 20 s wall)
      timeout: config.judge0.requestTimeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...(config.judge0.apiKey && {
          'X-Auth-Token': config.judge0.apiKey,
        }),
      },
    });
  }
  
  /**
   * Run one submission synchronously.
   *
   * Always base64: with base64_encoded=false Judge0 answers
   * `{ token, error }` and NO status whenever any output is not valid UTF-8
   * (g++ quotes identifiers with curly quotes, a program can print any byte),
   * which used to surface as "Judge0 service temporarily unavailable".
   */
  private async submit(submission: Judge0Submission): Promise<Judge0Response> {
    const encode = (text?: string) =>
      text === undefined ? undefined : Buffer.from(text, 'utf8').toString('base64');
    const decode = (text: string | null | undefined) =>
      text == null ? null : Buffer.from(text, 'base64').toString('utf8');

    const { data } = await this.client.post<Judge0Response & { error?: string }>(
      '/submissions?base64_encoded=true&wait=true',
      {
        ...submission,
        source_code: encode(submission.source_code),
        stdin: encode(submission.stdin),
        expected_output: encode(submission.expected_output),
      }
    );
    if (!data?.status) {
      throw new Error(`Judge0 returned no status: ${data?.error || JSON.stringify(data).slice(0, 200)}`);
    }
    return {
      ...data,
      stdout: decode(data.stdout),
      stderr: decode(data.stderr),
      compile_output: decode(data.compile_output),
      message: decode(data.message),
    };
  }

  /**
   * Run a problem checker inside Judge0.
   *
   * Some problems accept several different correct answers ("print any such
   * string", "output the points in any order"). Comparing against one stored
   * string marks correct code wrong, so those problems ship a real checker.
   *
   * The checker is a standalone program with the contract:
   *
   *     python checker.py <input_file> <expected_file> <submission_file>
   *
   * printing a score on its last line: 0 for wrong answer, non-zero for
   * accepted (`1` and `100` are both common).
   *
   * It is executed BY JUDGE0 rather than in-process: CheckerService correctly
   * refuses to eval checker code in the API process, and Judge0 already gives
   * us cgroup/namespace isolation. The three files are handed over as a ZIP in
   * `additional_files`, which Judge0 extracts into /box.
   *
   * Returns true (accepted), false (rejected), or null if the checker itself
   * failed to run -- null must NOT be treated as accepted.
   */
  async runChecker(
    checkerCode: string,
    stdin: string,
    expectedOutput: string,
    submissionOutput: string
  ): Promise<boolean | null> {
    const additionalFiles = createZipBase64([
      { name: 'in.txt', data: stdin },
      { name: 'exp.txt', data: expectedOutput },
      { name: 'sub.txt', data: submissionOutput },
    ]);

    let response: { data: Judge0Response };
    try {
      response = {
        data: await this.submit({
          source_code: checkerCode,
          language_id: CHECKER_LANGUAGE_ID,
          command_line_arguments: 'in.txt exp.txt sub.txt',
          additional_files: additionalFiles,
          cpu_time_limit: 5,
          memory_limit: 256000,
        }),
      };
    } catch (error: any) {
      console.error('Checker submission failed:', error.message);
      return null;
    }

    // The checker running successfully means Judge0 reports Accepted -- that
    // says nothing about the submission. The verdict is in the checker's
    // stdout, so a non-zero exit status is a checker failure, not a rejection.
    const statusId = response.data.status?.id;
    if (statusId !== 3 && statusId !== 4) {
      console.error(
        `Checker did not run cleanly (status ${statusId}: ${response.data.status?.description})`
      );
      return null;
    }

    return this.parseCheckerVerdict(response.data.stdout);
  }

  /**
   * Read the checker's verdict from its stdout.
   * Anything that is not a recognisable score returns null rather than a
   * default, so an unreadable checker never silently accepts code.
   */
  private parseCheckerVerdict(stdout: string | null): boolean | null {
    if (!stdout) return null;
    const lines = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return null;

    const last = lines[lines.length - 1];
    const score = Number(last);
    if (!Number.isNaN(score) && /^-?\d+$/.test(last)) {
      return score > 0;
    }

    const word = last.toUpperCase();
    if (['AC', 'ACCEPTED', 'YES', 'TRUE'].includes(word)) return true;
    if (['WA', 'WRONG', 'NO', 'FALSE'].includes(word)) return false;
    return null;
  }

  /**
   * Execute code against all test cases
   * Returns aggregated results
   *
   * Exact-match problems in a supported language are judged in ONE Judge0
   * run (see BatchJudge). Everything else, and any batch run that cannot be
   * trusted, is judged one test per Judge0 submission.
   *
   * Runs are serialised (config.judge0.maxParallelRuns): the per-test time
   * limits are wall-clock, so two programs sharing one CPU would push each
   * other into false time-limit failures.
   *
   * @param sourceCode - The user's code
   * @param languageId - Judge0 language ID
   * @param testCases - Array of test cases
   * @param checkerType - How to validate answers (defaults to 'exact')
   * @param checkerCode - Custom checker code for 'custom' type
   */
  async executeCode(
    sourceCode: string,
    languageId: number,
    testCases: TestCase[],
    checkerType: CheckerType = 'exact',
    checkerCode?: string,
    onQueued?: (ahead: number) => void
  ): Promise<SubmissionResult> {
    console.log(`🔬 Executing code (lang: ${languageId}) against ${testCases.length} test cases`);
    console.log(`   Checker type: ${checkerType}`);

    return this.withRunSlot(async () => {
      if (config.judge0.batch && checkerType === 'exact' && batchLanguage(languageId)) {
        const started = Date.now();
        try {
          const result = await this.executeBatch(sourceCode, languageId, testCases);
          if (result) {
            console.log(`📊 Batch result: ${result.status} (${result.passed}/${result.total}) in ${Date.now() - started}ms`);
            return result;
          }
        } catch (error: any) {
          console.error(`   Batch judging failed: ${this.describeError(error)}`);
          if (axios.isAxiosError(error) && !error.response) {
            // Judge0 did not answer at all (timeout, connection refused).
            // Judging test by test would only fail more slowly.
            return this.summarize(
              testCases.map((tc, i) => ({
                testIndex: i,
                passed: false,
                status: 'Judge0 Error',
                hidden: tc.isHidden !== false,
                expected: tc.expectedOutput,
              }))
            );
          }
        }
        console.warn('   Falling back to judging test by test');
      }
      return this.executePerTest(sourceCode, languageId, testCases, checkerType, checkerCode);
    }, onQueued);
  }

  // ------------------------------------------------------------
  // Run slots
  // ------------------------------------------------------------
  private activeRuns = 0;
  private waitingRuns: Array<() => void> = [];

  /** How busy the judge is, for /health and capacity planning */
  getLoad(): { maxParallelRuns: number; active: number; waiting: number } {
    return { maxParallelRuns: config.judge0.maxParallelRuns, active: this.activeRuns, waiting: this.waitingRuns.length };
  }

  /**
   * Run fn once a slot is free. onQueued hears how many runs are ahead when
   * this one has to wait, so the player can be told instead of left guessing.
   */
  private async withRunSlot<T>(fn: () => Promise<T>, onQueued?: (ahead: number) => void): Promise<T> {
    if (this.activeRuns < config.judge0.maxParallelRuns) {
      this.activeRuns++;
    } else {
      const ahead = this.waitingRuns.length + 1;
      try {
        onQueued?.(ahead);
      } catch {
        /* a listener's failure never holds up judging */
      }
      // The slot is handed over directly by release, so activeRuns stays put
      await new Promise<void>((resolve) => this.waitingRuns.push(resolve));
    }
    try {
      return await fn();
    } finally {
      const next = this.waitingRuns.shift();
      if (next) next();
      else this.activeRuns--;
    }
  }

  // ------------------------------------------------------------
  // Batch path: compile once, run every test in one sandbox
  // ------------------------------------------------------------
  private limits: Judge0Limits | null = null;

  private async getLimits(): Promise<Judge0Limits> {
    if (this.limits) return this.limits;
    try {
      const { data } = await this.client.get('/config_info', { timeout: 5000 });
      this.limits = {
        maxCpu: Number(data.max_cpu_time_limit) || DEFAULT_LIMITS.maxCpu,
        maxWall: Number(data.max_wall_time_limit) || DEFAULT_LIMITS.maxWall,
        maxFileSize: Number(data.max_max_file_size) || DEFAULT_LIMITS.maxFileSize,
        maxStack: Number(data.max_stack_limit) || DEFAULT_LIMITS.maxStack,
      };
      return this.limits;
    } catch {
      return DEFAULT_LIMITS; // not cached, so the next run asks again
    }
  }

  /**
   * Returns null when this submission should be judged per test instead
   * (inputs too large, harness output not trustworthy). Throws on Judge0
   * errors, which the caller also treats as "fall back".
   */
  private async executeBatch(
    sourceCode: string,
    languageId: number,
    testCases: TestCase[]
  ): Promise<SubmissionResult | null> {
    const language = batchLanguage(languageId)!;
    const inputBytes = testCases.reduce((sum, tc) => sum + Buffer.byteLength(tc.input), 0);
    if (inputBytes > BATCH_MAX_INPUT_BYTES) {
      console.warn(`   Inputs are ${inputBytes} bytes, too large for one batch`);
      return null;
    }

    const limits = await this.getLimits();
    const cpu = Math.min(15, limits.maxCpu);
    const wall = Math.min(20, limits.maxWall);
    // Leave the harness time to print its last lines before Judge0 stops it
    const budgetMs = Math.max(2000, Math.min(wall - 2, cpu - 1) * 1000);

    const harness = buildHarness({
      testCount: testCases.length,
      sampleTests: testCases.flatMap((tc, i) => (tc.isHidden === false ? [i + 1] : [])),
      perTestMs: config.judge0.testTimeLimitMs,
      budgetMs,
      runLine: language.run,
    });

    const files = [
      { name: language.sourceFile, data: sourceCode },
      { name: 'run', data: harness },
      ...(language.compile ? [{ name: 'compile', data: `${language.compile}\n` }] : []),
      ...testCases.map((tc, i) => ({ name: `in/${i + 1}`, data: tc.input })),
    ];

    const data = await this.submit({
      language_id: MULTI_FILE_LANGUAGE_ID,
      additional_files: createZipBase64(files),
      cpu_time_limit: cpu,
      wall_time_limit: wall,
      memory_limit: 256000,
      stack_limit: Math.min(128000, limits.maxStack),
      max_file_size: Math.min(4096, limits.maxFileSize),
    });

    const statusId = data.status?.id;
    if (statusId === STATUS_COMPILE_ERROR) {
      return this.summarize(
        testCases.map((tc, i) => ({
          testIndex: i,
          passed: false,
          status: 'Compilation Error',
          hidden: tc.isHidden !== false,
          expected: tc.expectedOutput,
        })),
        data.compile_output || 'Compilation failed'
      );
    }

    const testResults = parseHarnessOutput(data.stdout, testCases, statusId === STATUS_TLE);
    if (!testResults) {
      console.error(
        `   Batch harness output unusable (status ${statusId}: ${data.status?.description}; ` +
          `${(data.message || data.stdout || '').slice(0, 200)})`
      );
      return null;
    }
    return this.summarize(testResults);
  }

  private describeError(error: any): string {
    const status = error?.response?.status;
    const body = error?.response?.data ? JSON.stringify(error.response.data).slice(0, 300) : '';
    return [error?.message, status && `HTTP ${status}`, body].filter(Boolean).join(' ');
  }

  // ------------------------------------------------------------
  // Per-test path: one Judge0 submission per test
  // ------------------------------------------------------------
  private async executePerTest(
    sourceCode: string,
    languageId: number,
    testCases: TestCase[],
    checkerType: CheckerType,
    checkerCode?: string
  ): Promise<SubmissionResult> {
    const testResults: TestResult[] = new Array(testCases.length);
    let compileOutput: string | undefined;
    let nextTestIndex = 0;
    
    // Determine how the answer is validated:
    //   exact          -> Judge0's built-in comparison against expected_output
    //   custom + code  -> the problem's real checker, run inside Judge0
    //   anything else  -> CheckerService's in-process heuristics
    const useBuiltinComparison = checkerType === 'exact';
    const useProblemChecker = checkerType === 'custom' && !!checkerCode;

    const workerCount = Math.min(config.judge0.perTestConcurrency, testCases.length);

    const runWorker = async (): Promise<void> => {
      while (true) {
        const i = nextTestIndex++;
        if (i >= testCases.length) {
          return;
        }

        const testCase = testCases[i];

        try {
          // For exact match, use Judge0's comparison (faster)
          // For other types, run without expected_output and validate ourselves
          const result = await this.runSingleTest(
            sourceCode,
            languageId,
            testCase.input,
            useBuiltinComparison ? testCase.expectedOutput : undefined
          );

          let passed: boolean;
          let statusMessage = result.status.description;
          let checkerMessage: string | undefined;
          if (result.status.id === STATUS_COMPILE_ERROR && result.compile_output) {
            compileOutput ??= result.compile_output;
          }

          if (useBuiltinComparison) {
            // Use Judge0's result directly
            passed = result.status.id === 3; // 3 = Accepted
          } else if (result.status.id !== 3 && result.status.id !== 4) {
            // Not Accepted or Wrong Answer - it's an error (CE / TLE / RE).
            // For a checker problem a compile error or crash is still a failure,
            // so we never reach the checker here.
            passed = false;
          } else if (useProblemChecker) {
            // Ask the problem's own checker. `null` means the checker itself
            // broke -- treat that as not-passed rather than as a pass.
            const verdict = await this.runChecker(
              checkerCode!,
              testCase.input,
              testCase.expectedOutput,
              result.stdout || ''
            );
            passed = verdict === true;
            if (verdict === null) {
              statusMessage = 'Checker error';
              console.error(
                `   Checker failed on test ${i + 1} — treating as not passed`
              );
            }
          } else {
            // Use our custom checker
            const checkerResult = checkerService.validate({
              userOutput: result.stdout || '',
              expectedOutput: testCase.expectedOutput,
              testInput: testCase.input,
              checkerType,
              checkerCode,
            });
            passed = checkerResult.passed;
            if (!passed) {
              // Keep checker detail out of status: it can quote the expected output
              statusMessage = 'Wrong Answer';
              checkerMessage = checkerResult.message;
            }
          }

          testResults[i] = {
            testIndex: i,
            passed,
            status: statusMessage,
            hidden: testCase.isHidden !== false,
            stdout: result.stdout || undefined,
            expected: testCase.expectedOutput,
            message: checkerMessage,
            time: result.time,
            memory: result.memory,
          };

          console.log(`   Test ${i + 1}/${testCases.length}: ${passed ? '✅' : '❌'} ${statusMessage}`);
        } catch (error: any) {
          console.error(`   Test ${i + 1}/${testCases.length}: ❌ Judge0 Error - ${this.describeError(error)}`);
          testResults[i] = {
            testIndex: i,
            passed: false,
            status: 'Judge0 Error',
            hidden: testCase.isHidden !== false,
            stdout: `Judge0 API Error: ${error.message}`,
            expected: testCase.expectedOutput,
          };
        }
      }
    };

    await Promise.all(
      Array.from({ length: workerCount }, () => runWorker())
    );
    
    const result = this.summarize(testResults, compileOutput);
    console.log(`📊 Final result: ${result.status} (${result.passed}/${result.total})`);
    return result;
  }

  /** Overall verdict for a set of test results, shared by both paths */
  private summarize(testResults: TestResult[], compileOutput?: string): SubmissionResult {
    const passed = testResults.filter(r => r.passed).length;
    const total = testResults.length;
    const hasCompileError = testResults.some(r => r.status === 'Compilation Error');
    const hasRuntimeError = testResults.some(r =>
      r.status.includes('Runtime Error') || r.status.includes('NZEC')
    );
    const hasTLE = testResults.some(r => r.status === 'Time Limit Exceeded');
    const hasJudgeError = testResults.some(r => r.status === 'Judge0 Error');

    let status: SubmissionResult['status'] = 'wrong_answer';
    if (total > 0 && passed === total) status = 'accepted';
    else if (hasCompileError) status = 'compile_error';
    else if (hasRuntimeError) status = 'runtime_error';
    else if (hasTLE) status = 'time_limit';
    else if (hasJudgeError) status = 'runtime_error'; // Treat Judge0 errors as runtime errors

    return {
      status,
      passed,
      total,
      testResults,
      stdout: testResults[0]?.stdout,
      stderr: hasCompileError
        ? (compileOutput || 'Compilation failed').slice(0, 4000)
        : hasJudgeError
        ? 'Judge0 service temporarily unavailable. Please try again.'
        : undefined,
    };
  }
  
  /**
   * Run a single test case
   */
  private async runSingleTest(
    sourceCode: string,
    languageId: number,
    stdin: string,
    expectedOutput?: string
  ): Promise<Judge0Response> {
    const submission: Judge0Submission = {
      source_code: sourceCode,
      language_id: languageId,
      stdin: stdin,
      expected_output: expectedOutput,
      cpu_time_limit: 5, // 5 seconds
      memory_limit: 256000, // 256 MB
      // Same C++ dialect as batch judging, so a program behaves the same on both paths
      ...(languageId === 54 && { compiler_options: '-O2 -std=gnu++17 -DONLINE_JUDGE' }),
    };
    
    return this.submit(submission);
  }
  
  /**
   * Submit code and get token (async mode)
   * Use this for longer executions where you want to poll for results
   */
  async submitAsync(
    sourceCode: string,
    languageId: number,
    stdin: string
  ): Promise<string> {
    const submission: Judge0Submission = {
      source_code: sourceCode,
      language_id: languageId,
      stdin: stdin,
    };
    
    const response = await this.client.post<{ token: string }>(
      '/submissions?base64_encoded=false',
      submission
    );
    
    return response.data.token;
  }
  
  /**
   * Get submission result by token
   */
  async getSubmission(token: string): Promise<Judge0Response> {
    const response = await this.client.get<Judge0Response>(
      `/submissions/${token}?base64_encoded=false`
    );
    
    return response.data;
  }
  
  /**
   * Poll for submission result with timeout
   */
  async pollForResult(
    token: string,
    maxWaitMs: number = 30000,
    intervalMs: number = 500
  ): Promise<Judge0Response> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      const result = await this.getSubmission(token);
      
      // Status 1 = In Queue, 2 = Processing
      if (result.status.id !== 1 && result.status.id !== 2) {
        return result;
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    
    throw new Error('Submission timed out');
  }
  
  /**
   * Run a player's code on their own input, with nothing to compare against.
   * Queued behind the same run slots as judging, so a practice run never
   * shares the CPU with someone's submission and pushes it into a false TLE.
   */
  async runCustomInput(
    sourceCode: string,
    languageId: number,
    stdin: string,
    onQueued?: (ahead: number) => void
  ): Promise<CustomRunResult> {
    return this.withRunSlot(async () => {
      try {
        const r = await this.runSingleTest(sourceCode, languageId, stdin);
        const id = r.status.id;
        // 3 Accepted / 4 Wrong Answer both mean it ran to the end (no expected output was given)
        const status: CustomRunResult['status'] =
          id === 3 || id === 4 ? 'finished'
          : id === 5 ? 'time_limit'
          : id === 6 ? 'compile_error'
          : id >= 7 && id <= 12 ? 'runtime_error'
          : 'error';
        const errorText = id === 6 ? r.compile_output : r.stderr || (status === 'finished' ? null : r.message);
        return {
          status,
          stdout: (r.stdout ?? '').slice(0, 64_000),
          ...(errorText ? { stderr: errorText.slice(0, 8_000) } : {}),
          ...(r.time ? { time: r.time } : {}),
        };
      } catch (error: any) {
        console.error(`❌ Custom run failed: ${this.describeError(error)}`);
        return { status: 'error', stdout: '', stderr: 'The judge did not answer. Try again in a moment.' };
      }
    }, onQueued);
  }

  /**
   * Run code without validation (just execute and return output)
   * Used for "Run Code" feature
   */
  async runCode(
    sourceCode: string,
    languageId: number,
    stdin: string = ''
  ): Promise<Judge0Response> {
    return this.runSingleTest(sourceCode, languageId, stdin);
  }
}

/**
 * Reduce a submission result to what the submitter may see.
 *
 * Hidden tests keep only testIndex/passed/status, so their input (echoed via
 * stdout) and expected output never reach the client. Fields are copied from
 * an allow-list so anything added to TestResult later stays server-side.
 * A test without an explicit `hidden: false` is treated as hidden.
 */
export function sanitizeSubmissionResult(result: SubmissionResult): SubmissionResult {
  return {
    status: result.status,
    passed: result.passed,
    total: result.total,
    stderr: result.stderr,
    testResults: result.testResults?.map((r): TestResult => {
      if (r.hidden !== false) {
        return { testIndex: r.testIndex, passed: r.passed, status: r.status, hidden: true };
      }
      return {
        testIndex: r.testIndex,
        passed: r.passed,
        status: r.status,
        hidden: false,
        stdout: r.stdout,
        expected: r.expected,
        message: r.message,
        time: r.time,
        memory: r.memory,
      };
    }),
  };
}

// Singleton instance
export const judgeService = new JudgeService();

