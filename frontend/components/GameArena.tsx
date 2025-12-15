import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Play, CheckCircle, XCircle, Terminal, Maximize2, RotateCcw, Clock, ChevronDown, AlertCircle, Loader2 } from 'lucide-react';
import CodeEditor from './CodeEditor';
import { Judge0Response } from '../types';

// CONFIGURATION:
// Secure HTTPS Endpoint for Judge0
const JUDGE0_ENDPOINT = "https://judge.deadlock.sbs/submissions?base64_encoded=false&wait=true";

const LANGUAGE_IDS = {
  python: 71, // Python 3.8.1
  javascript: 63, // Node.js 12.14.0
  cpp: 54 // C++ (GCC 9.2.0)
};

const STARTER_CODE = {
  python: `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        # Write your code here
        # Example: return [0, 1]
        pass`,
  javascript: `/**
 * @param {number[]} nums
 * @param {number} target
 * @return {number[]}
 */
var twoSum = function(nums, target) {
    // Write your code here
    
};`,
  cpp: `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        // Write your code here
        
    }
};`
};

type Language = keyof typeof STARTER_CODE;

const TEST_CASES = [
    { input: 'nums = [2,7,11,15], target = 9', expected: '[0,1]', params: { nums: [2,7,11,15], target: 9 } },
    { input: 'nums = [3,2,4], target = 6', expected: '[1,2]', params: { nums: [3,2,4], target: 6 } },
    { input: 'nums = [3,3], target = 6', expected: '[0,1]', params: { nums: [3,3], target: 6 } }
];

const GameArena: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'problem' | 'submissions'>('problem');
  const [activeTestTab, setActiveTestTab] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<'idle' | 'success' | 'fail'>('idle');
  const [output, setOutput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  
  // Editor State
  const [language, setLanguage] = useState<Language>('python');
  const [code, setCode] = useState(STARTER_CODE.python);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    setCode(STARTER_CODE[lang]);
    setIsLangMenuOpen(false);
  };

  // Helper to format array for C++ vector
  const formatCppVector = (arr: number[]) => `{${arr.join(',')}}`;

  const generateDriverCode = (userCode: string, lang: Language, params: { nums: number[], target: number }) => {
    switch (lang) {
        case 'python':
            return `
import sys
from typing import List

${userCode}

if __name__ == '__main__':
    s = Solution()
    result = s.twoSum(${JSON.stringify(params.nums)}, ${params.target})
    print(result)
`;
        case 'javascript':
            return `
${userCode}

const result = twoSum(${JSON.stringify(params.nums)}, ${params.target});
console.log(JSON.stringify(result));
`;
        case 'cpp':
            return `
#include <iostream>
#include <vector>
#include <algorithm>
#include <string>

using namespace std;

${userCode}

int main() {
    Solution s;
    vector<int> nums = ${formatCppVector(params.nums)};
    int target = ${params.target};
    vector<int> result = s.twoSum(nums, target);
    cout << "[" << result[0] << "," << result[1] << "]";
    return 0;
}
`;
        default:
            return userCode;
    }
  };

  const executeCode = async () => {
    setIsRunning(true);
    setResults('idle');
    setError(null);
    setOutput('');

    const currentTest = TEST_CASES[activeTestTab];
    const sourceCode = generateDriverCode(code, language, currentTest.params);

    try {
        const response = await fetch(JUDGE0_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                source_code: sourceCode,
                language_id: LANGUAGE_IDS[language],
                stdin: "" // We are hardcoding inputs in driver code for now
            })
        });

        if (!response.ok) {
            throw new Error(`Server Error: ${response.status} ${response.statusText}`);
        }

        const data: Judge0Response = await response.json();

        if (data.status.id === 3) { // Accepted
            const rawOutput = data.stdout ? data.stdout.trim() : '';
            // Clean up output for comparison (remove whitespace, newlines)
            const cleanOutput = rawOutput.replace(/\s/g, '');
            const cleanExpected = currentTest.expected.replace(/\s/g, '');
            
            setOutput(rawOutput);
            
            if (cleanOutput === cleanExpected) {
                setResults('success');
            } else {
                setResults('fail');
                setError(`Expected ${currentTest.expected} but got ${rawOutput}`);
            }
        } else {
            // Compile Error or Runtime Error
            setResults('fail');
            const errorMsg = data.compile_output || data.stderr || data.message || 'Unknown execution error';
            setOutput(errorMsg);
            setError(data.status.description);
        }

    } catch (err) {
        console.error(err);
        setResults('fail');
        setError('Connection Error');
        setOutput('Could not reach Judge0 server at https://judge.deadlock.sbs. \n\nDetails: ' + String(err));
    } finally {
        setIsRunning(false);
    }
  };

  return (
    <div className="h-screen w-full bg-[#050505] flex flex-col font-mono overflow-hidden">
        {/* Game Header */}
        <div className="h-14 border-b border-stone-800 bg-[#0a0a0a] flex items-center justify-between px-4 z-20">
            <div className="flex items-center gap-4">
                <div className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-sm uppercase">Ranked Match</div>
                <div className="flex items-center gap-2 text-stone-400 text-xs">
                    <Clock className="w-3 h-3" />
                    <span>04:21 REMAINING</span>
                </div>
            </div>
            <div className="flex items-center gap-4">
                 <button 
                    onClick={executeCode}
                    disabled={isRunning}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold px-4 py-1.5 rounded-sm flex items-center gap-2 transition-colors"
                 >
                    <Play className="w-3 h-3 fill-current" />
                    SUBMIT
                 </button>
            </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
            
            {/* Left Panel: Problem */}
            <div className="w-1/2 border-r border-stone-800 flex flex-col bg-[#050505]">
                {/* Tabs */}
                <div className="flex border-b border-stone-800">
                    <button 
                        onClick={() => setActiveTab('problem')}
                        className={`px-6 py-3 text-xs font-bold uppercase tracking-widest ${activeTab === 'problem' ? 'text-white border-b-2 border-red-600 bg-stone-900/50' : 'text-stone-600 hover:text-stone-400'}`}
                    >
                        Description
                    </button>
                    <button 
                         onClick={() => setActiveTab('submissions')}
                         className={`px-6 py-3 text-xs font-bold uppercase tracking-widest ${activeTab === 'submissions' ? 'text-white border-b-2 border-red-600 bg-stone-900/50' : 'text-stone-600 hover:text-stone-400'}`}
                    >
                        Submissions
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    <div className="flex justify-between items-start mb-6">
                        <h1 className="text-2xl font-black text-white uppercase tracking-tight">Two Sum</h1>
                        <span className="text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded text-[10px] font-bold">EASY</span>
                    </div>

                    <div className="prose prose-invert prose-sm max-w-none text-stone-400">
                        <p>Given an array of integers <code>nums</code> and an integer <code>target</code>, return <em>indices of the two numbers such that they add up to <code>target</code></em>.</p>
                        <p>You may assume that each input would have <strong>exactly one solution</strong>, and you may not use the <em>same</em> element twice.</p>
                        <p>You can return the answer in any order.</p>

                        <div className="my-6">
                            <h4 className="text-white font-bold text-xs uppercase mb-2">Example 1:</h4>
                            <div className="bg-stone-900/50 border border-stone-800 p-4 rounded-sm font-mono text-xs">
                                <span className="text-stone-500">Input:</span> <span className="text-stone-300">nums = [2,7,11,15], target = 9</span><br/>
                                <span className="text-stone-500">Output:</span> <span className="text-stone-300">[0,1]</span><br/>
                                <span className="text-stone-500">Explanation:</span> <span className="text-stone-400">Because nums[0] + nums[1] == 9, we return [0, 1].</span>
                            </div>
                        </div>

                        <div className="my-6">
                            <h4 className="text-white font-bold text-xs uppercase mb-2">Example 2:</h4>
                            <div className="bg-stone-900/50 border border-stone-800 p-4 rounded-sm font-mono text-xs">
                                <span className="text-stone-500">Input:</span> <span className="text-stone-300">nums = [3,2,4], target = 6</span><br/>
                                <span className="text-stone-500">Output:</span> <span className="text-stone-300">[1,2]</span>
                            </div>
                        </div>

                        <div className="my-8 pt-8 border-t border-stone-800">
                            <h4 className="text-white font-bold text-xs uppercase mb-2">Constraints:</h4>
                            <ul className="list-disc pl-4 space-y-1 text-xs text-stone-500">
                                <li><code>2 {'<='} nums.length {'<='} 10^4</code></li>
                                <li><code>-10^9 {'<='} nums[i] {'<='} 10^9</code></li>
                                <li><code>-10^9 {'<='} target {'<='} 10^9</code></li>
                                <li>Only one valid answer exists.</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Panel: Editor & Test Cases */}
            <div className="w-1/2 flex flex-col h-full bg-[#080808]">
                
                {/* Code Editor Header */}
                <div className="h-10 bg-[#0a0a0a] border-b border-stone-800 flex items-center justify-between px-4">
                    <div className="relative">
                        <button 
                            onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
                            className="flex items-center gap-2 text-[10px] text-stone-400 hover:text-white font-bold uppercase transition-colors"
                        >
                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                            {language === 'cpp' ? 'C++' : language}
                            <ChevronDown className="w-3 h-3" />
                        </button>
                        
                        {isLangMenuOpen && (
                            <div className="absolute top-full left-0 mt-2 w-32 bg-[#0a0a0a] border border-stone-800 rounded-sm shadow-xl z-50 py-1">
                                {Object.keys(STARTER_CODE).map((lang) => (
                                    <button
                                        key={lang}
                                        onClick={() => handleLanguageChange(lang as Language)}
                                        className={`w-full text-left px-3 py-2 text-[10px] font-bold uppercase hover:bg-stone-900 ${language === lang ? 'text-red-500' : 'text-stone-400'}`}
                                    >
                                        {lang === 'cpp' ? 'C++' : lang}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                         <button 
                            onClick={() => setCode(STARTER_CODE[language])}
                            className="text-stone-600 hover:text-white transition-colors" 
                            title="Reset Code"
                         >
                             <RotateCcw className="w-3.5 h-3.5" />
                         </button>
                         <button className="text-stone-600 hover:text-white transition-colors" title="Maximize">
                             <Maximize2 className="w-3.5 h-3.5" />
                         </button>
                    </div>
                </div>

                {/* Code Editor Area */}
                <div className="flex-1 relative overflow-hidden bg-[#0c0c0c]">
                    <CodeEditor language={language} code={code} onChange={setCode} />
                </div>

                {/* Test Cases Area */}
                <div className="h-48 bg-[#050505] flex flex-col border-t border-stone-800">
                    <div className="h-8 border-b border-stone-800 flex items-center px-2">
                        <button className={`flex items-center gap-2 px-3 h-full text-[10px] font-bold border-b transition-colors ${error ? 'text-red-500 border-red-500' : 'text-white border-stone-600'}`}>
                            <Terminal className="w-3 h-3" />
                            {error ? 'Execution Error' : 'Test Results'}
                        </button>
                        <div className="flex-1"></div>
                        <button 
                            onClick={executeCode}
                            disabled={isRunning}
                            className="text-[10px] font-bold text-stone-400 hover:text-white uppercase px-3 flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} 
                            Run Code
                        </button>
                    </div>

                    <div className="flex-1 p-4 flex gap-4 overflow-hidden">
                        {/* Case Tabs */}
                        <div className="w-32 flex flex-col gap-1 border-r border-stone-800 pr-4">
                             {TEST_CASES.map((_, i) => (
                                 <button 
                                    key={i}
                                    onClick={() => { setActiveTestTab(i); setResults('idle'); setOutput(''); setError(null); }}
                                    className={`text-left px-2 py-1.5 rounded-sm text-[10px] font-mono flex items-center justify-between transition-colors ${activeTestTab === i ? 'bg-stone-800 text-white' : 'text-stone-600 hover:bg-stone-900'}`}
                                 >
                                    Case {i + 1}
                                    {activeTestTab === i && results === 'success' && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>}
                                    {activeTestTab === i && results === 'fail' && <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>}
                                 </button>
                             ))}
                        </div>
                        
                        {/* Output */}
                        <div className="flex-1 font-mono text-xs overflow-auto">
                            {isRunning ? (
                                <div className="flex items-center gap-2 text-stone-500 mt-2">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Running on Judge0 Server...
                                </div>
                            ) : results !== 'idle' ? (
                                <div className="space-y-3 animate-in fade-in duration-300">
                                    {results === 'success' ? (
                                        <div className="flex items-center gap-2 text-emerald-500 font-bold mb-2">
                                            <CheckCircle className="w-4 h-4" />
                                            Passed
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 text-red-500 font-bold mb-2">
                                            <XCircle className="w-4 h-4" />
                                            {error || 'Failed'}
                                        </div>
                                    )}

                                    <div className="bg-stone-900/50 p-2 rounded-sm border border-stone-800">
                                        <span className="text-stone-500 block text-[10px] uppercase mb-1">Input</span>
                                        <span className="text-stone-300">{TEST_CASES[activeTestTab].input}</span>
                                    </div>
                                    
                                    {/* Actual Output from Judge */}
                                    <div className={`bg-stone-900/50 p-2 rounded-sm border ${results === 'fail' && !error ? 'border-red-900/50' : 'border-stone-800'}`}>
                                        <span className="text-stone-500 block text-[10px] uppercase mb-1">
                                            {error ? 'Error Log' : 'Standard Output'}
                                        </span>
                                        <pre className={`whitespace-pre-wrap ${error ? 'text-red-400' : 'text-stone-300'}`}>
                                            {output || (error ? 'Runtime Error' : '(No Output)')}
                                        </pre>
                                    </div>

                                    {results === 'fail' && !error && (
                                        <div className="bg-stone-900/50 p-2 rounded-sm border border-stone-800">
                                            <span className="text-stone-500 block text-[10px] uppercase mb-1">Expected Output</span>
                                            <span className="text-stone-300">{TEST_CASES[activeTestTab].expected}</span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="text-stone-600 italic mt-2 flex flex-col gap-2">
                                    <p>Ready to execute on Judge0 (HTTPS Secure).</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
};

export default GameArena;