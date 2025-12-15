import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import {
  Judge0Submission,
  Judge0Response,
  TestCase,
  SubmissionResult,
  TestResult,
} from '../types';

/**
 * JudgeService - Handles code execution via Judge0 API
 * 
 * This service is non-blocking and async.
 * It submits code to Judge0 and returns the results.
 */
export class JudgeService {
  private client: AxiosInstance;
  
  constructor() {
    this.client = axios.create({
      baseURL: config.judge0.url,
      timeout: 30000, // 30 second timeout
      headers: {
        'Content-Type': 'application/json',
        ...(config.judge0.apiKey && {
          'X-Auth-Token': config.judge0.apiKey,
        }),
      },
    });
  }
  
  /**
   * Execute code against all test cases
   * Returns aggregated results
   */
  async executeCode(
    sourceCode: string,
    languageId: number,
    testCases: TestCase[]
  ): Promise<SubmissionResult> {
    console.log(`🔬 Executing code (lang: ${languageId}) against ${testCases.length} test cases`);
    
    const testResults: TestResult[] = [];
    let passedCount = 0;
    
    // Run each test case with error handling
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      
      try {
        const result = await this.runSingleTest(
          sourceCode,
          languageId,
          testCase.input,
          testCase.expectedOutput
        );
        
        const passed = result.status.id === 3; // 3 = Accepted
        if (passed) passedCount++;
        
        testResults.push({
          testIndex: i,
          passed,
          status: result.status.description,
          stdout: result.stdout || undefined,
          expected: testCase.expectedOutput,
          time: result.time,
          memory: result.memory,
        });
        
        // Log progress
        console.log(`   Test ${i + 1}/${testCases.length}: ${passed ? '✅' : '❌'} ${result.status.description}`);
        
      } catch (error: any) {
        // Handle Judge0 API errors gracefully
        console.error(`   Test ${i + 1}/${testCases.length}: ❌ Judge0 Error - ${error.message}`);
        testResults.push({
          testIndex: i,
          passed: false,
          status: 'Judge0 Error',
          stdout: `Judge0 API Error: ${error.message}`,
          expected: testCase.expectedOutput,
        });
      }
    }
    
    // Determine overall status
    const allPassed = passedCount === testCases.length;
    const hasCompileError = testResults.some(r => r.status === 'Compilation Error');
    const hasRuntimeError = testResults.some(r =>
      r.status.includes('Runtime Error') || r.status.includes('NZEC')
    );
    const hasTLE = testResults.some(r => r.status === 'Time Limit Exceeded');
    const hasJudgeError = testResults.some(r => r.status === 'Judge0 Error');
    
    let status: SubmissionResult['status'] = 'wrong_answer';
    if (allPassed) status = 'accepted';
    else if (hasCompileError) status = 'compile_error';
    else if (hasRuntimeError) status = 'runtime_error';
    else if (hasTLE) status = 'time_limit';
    else if (hasJudgeError) status = 'runtime_error'; // Treat Judge0 errors as runtime errors
    
    const result: SubmissionResult = {
      status,
      passed: passedCount,
      total: testCases.length,
      testResults,
      stdout: testResults[0]?.stdout,
      stderr: hasCompileError
        ? testResults.find(r => r.status === 'Compilation Error')?.stdout
        : hasJudgeError
        ? 'Judge0 service temporarily unavailable. Please try again.'
        : undefined,
    };
    
    console.log(`📊 Final result: ${status} (${passedCount}/${testCases.length})`);
    
    return result;
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
    };
    
    // Submit with wait=true for synchronous result
    const response = await this.client.post<Judge0Response>(
      '/submissions?base64_encoded=false&wait=true',
      submission
    );
    
    return response.data;
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

// Singleton instance
export const judgeService = new JudgeService();


