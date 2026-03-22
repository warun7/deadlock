import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { CheckerType, MatchMode, Problem, TestCase } from '../types';
import { problemHalfBand } from '../utils/ratingBand';
import {
  difficultyRatingAsInt,
  normalizeProblemRating,
} from '../utils/problemRating';

// Initialize Supabase client
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

/**
 * ProblemService - Fetches problems and test cases for matches
 */
export class ProblemService {
  private async randomProblemIdViaRpc(
    minRating: number,
    maxRating: number,
  ): Promise<number | null> {
    const { data, error } = await supabase.rpc('random_problem_id_in_rating_band', {
      p_min: minRating,
      p_max: maxRating,
    });
    if (error) {
      if (error.code !== 'PGRST202') {
        console.warn('random_problem_id_in_rating_band RPC:', error.message);
      }
      return null;
    }
    if (data === null || data === undefined) return null;
    const id = typeof data === 'number' ? data : parseInt(String(data), 10);
    return Number.isFinite(id) ? id : null;
  }

  private async buildProblemFromDbRow(problem: {
    id: number | string;
    title: string;
    description: string;
    difficulty: unknown;
    checker_type?: string;
    checker_code?: string | null;
  }): Promise<Problem> {
    const testCases = await this.getTestCases(problem.id);
    return {
      id: problem.id.toString(),
      title: problem.title,
      description: problem.description,
      difficulty: normalizeProblemRating(problem.difficulty),
      testCases,
      checkerType: (problem.checker_type || 'exact') as CheckerType,
      checkerCode: problem.checker_code || undefined,
    };
  }

  /**
   * Fetch one random problem in [minRating, maxRating] or null if none.
   * Prefers DB RPC (one row) when migration 008 is applied; otherwise loads the pool
   * and filters by numeric difficulty so text columns do not use lexicographic gte/lte.
   */
  private async pickRandomProblemInRatingRange(
    minRating: number,
    maxRating: number,
  ): Promise<Problem | null> {
    try {
      const rpcId = await this.randomProblemIdViaRpc(minRating, maxRating);
      if (rpcId !== null) {
        const { data: problem, error } = await supabase
          .from('problems')
          .select('*')
          .eq('id', rpcId)
          .maybeSingle();

        if (!error && problem) {
          return this.buildProblemFromDbRow(problem);
        }
      }

      const { data: problems, error } = await supabase.from('problems').select('*');

      if (error) {
        console.error('Error fetching problems:', error);
        return null;
      }

      const inBand = (problems ?? []).filter((row) => {
        const n = difficultyRatingAsInt(row.difficulty);
        return n !== null && n >= minRating && n <= maxRating;
      });

      if (!inBand.length) return null;

      const problem = inBand[Math.floor(Math.random() * inBand.length)];
      return this.buildProblemFromDbRow(problem);
    } catch (e) {
      console.error('pickRandomProblemInRatingRange:', e);
      return null;
    }
  }

  /**
   * Legacy helper — prefer getRandomProblemForSkill for matches.
   */
  async getRandomProblem(options?: {
    minRating?: number;
    maxRating?: number;
  }): Promise<Problem | null> {
    const min = options?.minRating ?? config.problems.globalMin;
    const max =
      options?.maxRating ?? Math.min(2000, config.problems.globalMax);
    const p = await this.pickRandomProblemInRatingRange(min, max);
    return p ?? this.getFallbackProblem();
  }

  /**
   * Pick a problem near player skill: widens the rating band until something matches.
   */
  async getRandomProblemForSkill(
    centerElo: number,
    mode: MatchMode,
  ): Promise<Problem | null> {
    const baseHalf = problemHalfBand(mode);
    const step = config.problems.bandWidenStep;
    const maxExtra = config.problems.bandMaxExtra;

    for (let extra = 0; extra <= maxExtra; extra += step) {
      const half = baseHalf + extra;
      const min = Math.max(
        config.problems.globalMin,
        Math.round(centerElo - half),
      );
      const max = Math.min(
        config.problems.globalMax,
        Math.round(centerElo + half),
      );
      const p = await this.pickRandomProblemInRatingRange(min, max);
      if (p) {
        console.log(
          `📝 Problem band [${mode}] ${min}–${max} (center ${centerElo}, +${extra} widen) → ${p.title}`,
        );
        return p;
      }
    }

    const wide = await this.pickRandomProblemInRatingRange(
      config.problems.globalMin,
      config.problems.globalMax,
    );
    return wide ?? this.getFallbackProblem();
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
        .order('order_index')
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
        difficulty: normalizeProblemRating(problem.difficulty),
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
      difficulty: '800', // Use rating number
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

