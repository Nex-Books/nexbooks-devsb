'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Flex,
  Grid,
  Icon,
  Skeleton,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
} from '@chakra-ui/react';
import {
  MdAccountBalance,
  MdAddCircleOutline,
  MdBarChart,
  MdDescription,
  MdGavel,
  MdOutlineReceiptLong,
  MdPeople,
  MdShowChart,
  MdTrendingDown,
  MdTrendingUp,
  MdUploadFile,
} from 'react-icons/md';
import { RiRobot2Line } from 'react-icons/ri';
import { useAuth } from 'context/AuthContext';
import { supabase } from 'lib/supabase';

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────

interface JournalLine {
  account_name: string;
  account_type: string;
  debit: number;
  credit: number;
}

interface JournalEntry {
  id: string;
  entry_date: string;
  description: string;
  total_amount: number;
  transaction_type: string;
  status?: string;
  journal_lines?: JournalLine[];
}

interface KPIs {
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  cashBalance: number;
  accountsReceivable: number;
  accountsPayable: number;
  gstPayable: number;
  gstReceivable: number;
}

interface MonthBucket {
  label: string;
  year: number;
  month: number;
  revenue: number;
  expense: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CARD_SHADOW = '0px 18px 40px rgba(112, 144, 176, 0.12)';
const TEXT_DARK = '#1B2559';
const TEXT_BODY = '#676C73';
const TEXT_MUTED = '#AEB2B9';
const BORDER = '#E3E5EA';
const PAGE_BG = '#FCFCFD';

const formatINR = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);

function getLast6Months(): MonthBucket[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return {
      label: d.toLocaleString('default', { month: 'short' }),
      year: d.getFullYear(),
