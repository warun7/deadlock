import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { Problem, TestCase } from '../types';

// Initialize Supabase client
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

/**
 * ProblemService - Fetches problems and test cases for matches
 */
export class ProblemService {
  
  /**
   * Get a random problem for a match
   * Optionally filter by difficulty or ELO range
   */
  async getRandomProblem(options?: {
    difficulty?: string;
    minElo?: number;
    maxElo?: number;
  }): Promise<Problem | null> {
    try {
      // Build query
      let query = supabase
        .from('problems')
        .select('*');
      
      // Apply difficulty filter if specified
      if (options?.difficulty) {
        query = query.eq('difficulty', options.difficulty);
      }
      
      // Get all matching problems
      const { data: problems, error } = await query;
      
      if (error) {
        console.error('Error fetching problems:', error);
        return null;
      }
      
      if (!problems || problems.length === 0) {
        console.warn('No problems found in database');
        return this.getFallbackProblem();
      }
      
      // Pick random problem
      const randomIndex = Math.floor(Math.random() * problems.length);
      const problem = problems[randomIndex];
      
      // Fetch test cases for this problem
      const testCases = await this.getTestCases(problem.id);
      
      return {
        id: problem.id.toString(),
        title: problem.title,
        description: problem.description,
        difficulty: this.extractDifficulty(problem.url || problem.difficulty),
        testCases: testCases,
      };
      
    } catch (error) {
      console.error('Error in getRandomProblem:', error);
      return this.getFallbackProblem();
    }
  }
  
  /**
   * Get test cases for a problem
   * Includes both visible (sample) and hidden test cases
   */
  async getTestCases(problemId: number | string): Promise<TestCase[]> {
    try {
      const { data: testCases, error } = await supabase
        .from('problem_test_cases')
        .select('*')
        .eq('problem_id', problemId)
        .order('id');
      
      if (error) {
        console.error('Error fetching test cases:', error);
        return this.getDefaultTestCases();
      }
      
      if (!testCases || testCases.length === 0) {
        console.warn(`No test cases found for problem ${problemId}`);
        return this.getDefaultTestCases();
      }
      
      return testCases.map((tc, index) => ({
        input: tc.input || '',
        expectedOutput: tc.expected_output || '',
        isHidden: index >= 2, // First 2 are visible, rest are hidden
      }));
      
    } catch (error) {
      console.error('Error in getTestCases:', error);
      return this.getDefaultTestCases();
    }
  }
  
  /**
   * Get problem by ID
   */
  async getProblemById(problemId: string | number): Promise<Problem | null> {
    try {
      const { data: problem, error } = await supabase
        .from('problems')
        .select('*')
        .eq('id', problemId)
        .single();
      
      if (error || !problem) {
        console.error('Error fetching problem:', error);
        return null;
      }
      
      const testCases = await this.getTestCases(problem.id);
      
      return {
        id: problem.id.toString(),
        title: problem.title,
        description: problem.description,
        difficulty: this.extractDifficulty(problem.url || problem.difficulty),
        testCases: testCases,
      };
      
    } catch (error) {
      console.error('Error in getProblemById:', error);
      return null;
    }
  }
  
  /**
   * Extract difficulty from URL or return default
   */
  private extractDifficulty(urlOrDifficulty: string): string {
    if (!urlOrDifficulty) return 'Medium';
    
    const lower = urlOrDifficulty.toLowerCase();
    if (lower.includes('easy')) return 'Easy';
    if (lower.includes('medium')) return 'Medium';
    if (lower.includes('hard')) return 'Hard';
    
    return 'Medium';
  }
  
  /**
   * Fallback problem when database is unavailable
   */
  private getFallbackProblem(): Problem {
    return {
      id: 'fallback-1',
      title: 'Two Sum',
      description: `Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.

You may assume that each input would have exactly one solution, and you may not use the same element twice.

You can return the answer in any order.

### Example 1:
**Input:** nums = [2,7,11,15], target = 9
**Output:** [0,1]
**Explanation:** Because nums[0] + nums[1] == 9, we return [0, 1].

### Example 2:
**Input:** nums = [3,2,4], target = 6
**Output:** [1,2]

### Constraints:
- 2 <= nums.length <= 10^4
- -10^9 <= nums[i] <= 10^9
- -10^9 <= target <= 10^9
- Only one valid answer exists.`,
      difficulty: 'Easy',
      testCases: [
        { input: '4\n2 7 11 15\n9', expectedOutput: '0 1', isHidden: false },
        { input: '3\n3 2 4\n6', expectedOutput: '1 2', isHidden: false },
        { input: '2\n3 3\n6', expectedOutput: '0 1', isHidden: true },
      ],
    };
  }
  
  /**
   * Default test cases when none are found
   */
  private getDefaultTestCases(): TestCase[] {
    return [
      { input: '', expectedOutput: '', isHidden: false },
    ];
  }
}

// Singleton instance
export const problemService = new ProblemService();

