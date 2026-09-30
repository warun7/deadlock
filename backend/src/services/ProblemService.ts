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
   * Capped at 1200 difficulty until ELO system is implemented
   *
   * Only `judge_safe` problems are eligible. That flag means exact-match
   * judging was verified sound for the problem (a known-accepted solution
   * passes every imported test). Problems with several valid answers, and
   * problems with no imported test cases at all, are excluded: serving them
   * means telling a player their correct solution is wrong.
   */
  async getRandomProblem(options?: {
    difficulty?: number;
    minRating?: number;
    maxRating?: number;
  }): Promise<Problem | null> {
    try {
      // Build query - cap at 1200 difficulty for now
      let query = supabase
        .from('problems')
        .select('*')
        .eq('judge_safe', true)
        .lte('difficulty', options?.maxRating || 1200); // Cap at 1200
      
      // Apply minimum rating if specified
      if (options?.minRating) {
        query = query.gte('difficulty', options.minRating);
      }
      
      // Get all matching problems
      const { data: problems, error } = await query;
      
      if (error) {
        console.error('Error fetching problems:', error);
        return null;
      }
      
      if (!problems || problems.length === 0) {
        console.warn('No judge_safe problems found with rating <= 1200');
        return this.getFallbackProblem();
      }
      
      // Pick a random problem, and make sure it can actually be judged.
      //
      // `judge_safe` should guarantee test cases exist, but a problem with none
      // starts a match nobody can submit to (GameService refuses with
      // PROBLEM_NOT_FOUND, so the player just sits there). Rather than trust the
      // flag blindly, try a few and skip any that turn out to be empty.
      const maxAttempts = Math.min(5, problems.length);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const problem = problems[Math.floor(Math.random() * problems.length)];
        const testCases = await this.getTestCases(problem.id);

        if (testCases.length === 0) {
          console.warn(
            `Problem ${problem.problem_id} (id ${problem.id}) is marked judge_safe but has no test cases; picking another`
          );
          continue;
        }

        return {
          id: problem.id.toString(),
          title: problem.title,
          description: problem.description,
          difficulty: problem.difficulty ?? 1000,
          testCases: testCases,
          checkerType: problem.checker_type || 'exact',
          checkerCode: problem.checker_code || undefined,
        };
      }

      console.error(
        `No judgeable problem found after ${maxAttempts} attempts (pool size ${problems.length})`
      );
      return this.getFallbackProblem();
      
    } catch (error) {
      console.error('Error in getRandomProblem:', error);
      return this.getFallbackProblem();
    }
  }
  
  /**
   * Get test cases for a problem
   * Includes both visible (sample) and hidden test cases
   *
   * Ordered by `order_index`, NOT `id`: `id` is a random UUID, so ordering by
   * it shuffled the sample tests.
   *
   * Visibility comes from the explicit `is_sample` flag, not from position.
   * Position was the old rule (`index >= 2`) and it leaked hidden judge tests
   * as "samples" for the 187 problems with only one example, and the 5 with
   * none.
   */
  async getTestCases(problemId: number | string): Promise<TestCase[]> {
    try {
      const { data: testCases, error } = await supabase
        .from('problem_test_cases')
        .select('*')
        .eq('problem_id', problemId)
        .order('order_index');
      
      if (error) {
        console.error('Error fetching test cases:', error);
        return this.getDefaultTestCases();
      }
      
      if (!testCases || testCases.length === 0) {
        console.warn(`No test cases found for problem ${problemId}`);
        return this.getDefaultTestCases();
      }
      
      return testCases.map((tc) => ({
        input: tc.input || '',
        expectedOutput: tc.expected_output || '',
        // Rows written before migration 009 have is_sample = false, which means
        // "hidden". That is the safe direction: publishing a judge test by
        // accident is the mistake worth defaulting against.
        isHidden: !tc.is_sample,
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
        difficulty: problem.difficulty ?? 1000,
        testCases: testCases,
        checkerType: problem.checker_type || 'exact',
        checkerCode: problem.checker_code || undefined,
      };
      
    } catch (error) {
      console.error('Error in getProblemById:', error);
      return null;
    }
  }
  
  /**
   * No longer needed - we use rating numbers directly
   * Kept for backwards compatibility
   */
  private extractDifficulty(urlOrDifficulty: string): string {
    // Return the difficulty as-is (should be a number like "1000", "1200", etc.)
    return urlOrDifficulty || '1000';
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
      difficulty: 800,
      testCases: [
        { input: '4\n2 7 11 15\n9', expectedOutput: '0 1', isHidden: false },
        { input: '3\n3 2 4\n6', expectedOutput: '1 2', isHidden: false },
        { input: '2\n3 3\n6', expectedOutput: '0 1', isHidden: true },
      ],
    };
  }
  
  /**
   * No test cases found.
   *
   * Returns an EMPTY list on purpose. This used to return a single test case
   * with blank input and blank expected output, which was catastrophic: the
   * judge then ran every submission against one empty input, and any program
   * that printed nothing was "accepted". GameService rejects an empty list
   * with PROBLEM_NOT_FOUND, which is the honest outcome -- refusing to judge
   * is far better than judging against nothing.
   */
  private getDefaultTestCases(): TestCase[] {
    return [];
  }
}

// Singleton instance
export const problemService = new ProblemService();
