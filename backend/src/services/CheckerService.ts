/**
 * CheckerService - Custom validation for competitive programming problems
 * 
 * For problems with multiple valid outputs, we can't use simple string comparison.
 * This service provides common checker patterns and custom validation logic.
 */

export type CheckerType = 
  | 'exact'           // Exact string match (default)
  | 'special_chars'   // Validates special character count
  | 'any_order'       // Output lines can be in any order
  | 'yes_no'          // Case-insensitive YES/NO check
  | 'float_tolerance' // Numbers within tolerance (1e-6)
  | 'multiline_any'   // Multiple valid answers, check each line
  | 'custom';         // Custom JS checker function

export interface CheckerInput {
  userOutput: string;
  expectedOutput: string;
  testInput: string;
  checkerType: CheckerType;
  checkerCode?: string; // For custom checkers
}

export interface CheckerResult {
  passed: boolean;
  message?: string;
}

export class CheckerService {
  
  /**
   * Validate user output against expected output using the specified checker
   */
  validate(input: CheckerInput): CheckerResult {
    const { userOutput, expectedOutput, testInput, checkerType, checkerCode } = input;
    
    // Normalize outputs (trim whitespace)
    const normalizedUser = this.normalizeOutput(userOutput);
    const normalizedExpected = this.normalizeOutput(expectedOutput);
    
    switch (checkerType) {
      case 'exact':
        return this.checkExact(normalizedUser, normalizedExpected);
      
      case 'special_chars':
        return this.checkSpecialChars(normalizedUser, testInput);
      
      case 'any_order':
        return this.checkAnyOrder(normalizedUser, normalizedExpected);
      
      case 'yes_no':
        return this.checkYesNo(normalizedUser, normalizedExpected);
      
      case 'float_tolerance':
        return this.checkFloatTolerance(normalizedUser, normalizedExpected);
      
      case 'multiline_any':
        return this.checkMultilineAny(normalizedUser, normalizedExpected);
      
      case 'custom':
        return this.checkCustom(normalizedUser, normalizedExpected, testInput, checkerCode);
      
      default:
        return this.checkExact(normalizedUser, normalizedExpected);
    }
  }
  
  /**
   * Normalize output: trim, normalize line endings, remove trailing newlines
   */
  private normalizeOutput(output: string): string {
    if (!output) return '';
    return output
      .replace(/\r\n/g, '\n')  // Normalize line endings
      .trim();                  // Remove leading/trailing whitespace
  }
  
  /**
   * Exact string match
   */
  private checkExact(userOutput: string, expectedOutput: string): CheckerResult {
    const passed = userOutput === expectedOutput;
    return { 
      passed,
      message: passed ? undefined : 'Output does not match expected'
    };
  }
  
  /**
   * Special Characters problem checker
   * For problems where we need to count characters equal to exactly one neighbor
   */
  private checkSpecialChars(userOutput: string, testInput: string): CheckerResult {
    // Parse the expected n from input (first line is t, second is n for each test)
    // For a single test case, input is just n
    const n = parseInt(testInput.trim().split('\n').pop()?.trim() || '0');
    
    if (n % 2 === 1) {
      // Odd n is impossible - user should output NO
      const passed = userOutput.toUpperCase().startsWith('NO');
      return { passed, message: passed ? undefined : 'Expected NO for odd n' };
    }
    
    // Even n - check if user output is valid
    const lines = userOutput.split('\n');
    if (lines[0].toUpperCase() !== 'YES') {
      return { passed: false, message: 'Expected YES for even n' };
    }
    
    const str = lines[1]?.toUpperCase() || '';
    if (str.length === 0 || str.length > 200) {
      return { passed: false, message: 'Invalid string length' };
    }
    
    // Check if all characters are uppercase letters
    if (!/^[A-Z]+$/.test(str)) {
      return { passed: false, message: 'String must contain only uppercase letters' };
    }
    
    // Count special characters
    let specialCount = 0;
    for (let i = 0; i < str.length; i++) {
      let matchesNeighbor = 0;
      if (i > 0 && str[i] === str[i - 1]) matchesNeighbor++;
      if (i < str.length - 1 && str[i] === str[i + 1]) matchesNeighbor++;
      if (matchesNeighbor === 1) specialCount++;
    }
    
    const passed = specialCount === n;
    return { 
      passed, 
      message: passed ? undefined : `Expected ${n} special chars, got ${specialCount}` 
    };
  }
  
  /**
   * Any order checker - lines can be in any order
   */
  private checkAnyOrder(userOutput: string, expectedOutput: string): CheckerResult {
    const userLines = userOutput.split('\n').sort();
    const expectedLines = expectedOutput.split('\n').sort();
    
    if (userLines.length !== expectedLines.length) {
      return { passed: false, message: 'Wrong number of lines' };
    }
    
    for (let i = 0; i < userLines.length; i++) {
      if (userLines[i] !== expectedLines[i]) {
        return { passed: false, message: 'Lines do not match when sorted' };
      }
    }
    
    return { passed: true };
  }
  
  /**
   * YES/NO checker - case insensitive, just checks first word
   */
  private checkYesNo(userOutput: string, expectedOutput: string): CheckerResult {
    const userFirst = userOutput.split(/\s+/)[0]?.toUpperCase();
    const expectedFirst = expectedOutput.split(/\s+/)[0]?.toUpperCase();
    
    const passed = userFirst === expectedFirst;
    return { 
      passed, 
      message: passed ? undefined : `Expected ${expectedFirst}, got ${userFirst}` 
    };
  }
  
  /**
   * Float tolerance checker - numbers should be within 1e-6
   */
  private checkFloatTolerance(userOutput: string, expectedOutput: string, tolerance = 1e-6): CheckerResult {
    const userNums = userOutput.split(/\s+/).map(parseFloat);
    const expectedNums = expectedOutput.split(/\s+/).map(parseFloat);
    
    if (userNums.length !== expectedNums.length) {
      return { passed: false, message: 'Wrong number of values' };
    }
    
    for (let i = 0; i < userNums.length; i++) {
      if (isNaN(userNums[i]) || isNaN(expectedNums[i])) {
        return { passed: false, message: 'Invalid number format' };
      }
      if (Math.abs(userNums[i] - expectedNums[i]) > tolerance) {
        return { passed: false, message: `Value ${i} differs: expected ${expectedNums[i]}, got ${userNums[i]}` };
      }
    }
    
    return { passed: true };
  }
  
  /**
   * Multiline any - for problems with multiple test cases in one run
   * Checks each pair of YES/answer or NO independently
   */
  private checkMultilineAny(userOutput: string, expectedOutput: string): CheckerResult {
    const userLines = userOutput.split('\n');
    const expectedLines = expectedOutput.split('\n');
    
    if (userLines.length !== expectedLines.length) {
      return { passed: false, message: 'Wrong number of lines' };
    }
    
    // Check line by line, but YES lines can have different valid answers
    for (let i = 0; i < expectedLines.length; i++) {
      const userLine = userLines[i].trim();
      const expectedLine = expectedLines[i].trim();
      
      // If expected is YES, just check that user also says YES
      if (expectedLine.toUpperCase() === 'YES') {
        if (userLine.toUpperCase() !== 'YES') {
          return { passed: false, message: `Line ${i + 1}: Expected YES` };
        }
      } else if (expectedLine.toUpperCase() === 'NO') {
        if (userLine.toUpperCase() !== 'NO') {
          return { passed: false, message: `Line ${i + 1}: Expected NO` };
        }
      } else {
        // For answer lines after YES, we can't validate without more context
        // This is a limitation - for full validation, use custom checker
      }
    }
    
    return { passed: true };
  }
  
  /**
   * Custom checker - runs user-provided JavaScript validation code
   * The checker code should define a function: check(userOutput, expectedOutput, testInput) => boolean | {passed: boolean, message?: string}
   */
  private checkCustom(
    userOutput: string, 
    expectedOutput: string, 
    testInput: string,
    checkerCode?: string
  ): CheckerResult {
    if (!checkerCode) {
      // Fall back to exact match if no custom code provided
      return this.checkExact(userOutput, expectedOutput);
    }
    
    try {
      // Create a sandboxed function from the checker code
      // The code should return true/false or {passed: boolean, message?: string}
      const checkFn = new Function('userOutput', 'expectedOutput', 'testInput', checkerCode);
      const result = checkFn(userOutput, expectedOutput, testInput);
      
      if (typeof result === 'boolean') {
        return { passed: result };
      }
      
      if (typeof result === 'object' && 'passed' in result) {
        return result;
      }
      
      return { passed: false, message: 'Invalid checker result' };
    } catch (error: any) {
      console.error('Custom checker error:', error.message);
      return { passed: false, message: `Checker error: ${error.message}` };
    }
  }
}

// Singleton instance
export const checkerService = new CheckerService();
