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
} from '../types';
import { checkerService } from './CheckerService';

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
    checkerCode?: string
  ): Promise<SubmissionResult> {
    console.log(`🔬 Executing code (lang: ${languageId}) against ${testCases.length} test cases`);
    console.log(`   Checker type: ${checkerType}`);
    
    const testResults: TestResult[] = [];
    let passedCount = 0;
    
    // Determine if we should use Judge0's built-in comparison or our checker
    const useBuiltinComparison = checkerType === 'exact';
    
    // Run each test case with error handling
    for (let i = 0; i < testCases.length; i++) {
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
        
        if (useBuiltinComparison) {
          // Use Judge0's result directly
          passed = result.status.id === 3; // 3 = Accepted
        } else {
          // Check for runtime/compile errors first
          if (result.status.id !== 3 && result.status.id !== 4) {
            // Not Accepted or Wrong Answer - it's an error
            passed = false;
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
            if (!passed && checkerResult.message) {
              statusMessage = checkerResult.message;
            }
          }
        }
        
        if (passed) passedCount++;
        
        testResults.push({
          testIndex: i,
          passed,
          status: statusMessage,
          stdout: result.stdout || undefined,
          expected: testCase.expectedOutput,
          time: result.time,
          memory: result.memory,
        });
        
        // Log progress
        console.log(`   Test ${i + 1}/${testCases.length}: ${passed ? '✅' : '❌'} ${statusMessage}`);
        
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


