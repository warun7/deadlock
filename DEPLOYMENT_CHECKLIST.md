# 🚀 Deployment Checklist

Use this checklist before deploying to production.

## ☑️ Pre-Deployment

### 1. Environment Variables
- [ ] All `.env` files are properly configured
- [ ] `.env` files are in `.gitignore`
- [ ] Production values set (not localhost URLs)
- [ ] Secrets are strong and unique

### 2. Database (Supabase)
- [ ] Run `database-indexes.sql` in Supabase SQL Editor
- [ ] Verify indexes were created (run verification query)
- [ ] RLS policies are enabled
- [ ] Storage policies are configured

### 3. Dependencies
- [ ] Run `npm install` in both `server/` and `deadlock/`
- [ ] No security vulnerabilities (`npm audit`)
- [ ] All TypeScript errors fixed

### 4. Code Quality
- [ ] No linter errors
- [ ] No console.errors in production code
- [ ] Sensitive data not logged
- [ ] Error messages don't expose internals

### 5. Testing
- [ ] Test environment validation (remove .env var)
- [ ] Test rate limiting (make 101 requests)
- [ ] Test graceful shutdown (Ctrl+C)
- [ ] Test matchmaking with 2 accounts
- [ ] Test code submission
- [ ] Test forfeit

## 🏗️ Infrastructure

### 1. Redis
- [ ] Redis URL is production instance
- [ ] Password-protected
- [ ] Persistence enabled
- [ ] Backup strategy in place

### 2. Judge0
- [ ] Judge0 URL is correct
- [ ] Rate limits configured
- [ ] API key (if required)

### 3. Server
- [ ] `NODE_ENV=production`
- [ ] Port configured correctly
- [ ] CORS origins set to production frontend URL
- [ ] SSL/TLS enabled

### 4. Frontend
- [ ] Build created (`npm run build`)
- [ ] Environment variables set
- [ ] API URLs point to production
- [ ] No development tools in bundle

## 🔒 Security

- [ ] Rate limiting enabled
- [ ] Security headers configured (Helmet)
- [ ] Input validation on all endpoints
- [ ] JWT secrets are strong
- [ ] Database credentials secured
- [ ] No API keys in frontend code

## 📊 Monitoring

- [ ] Logs directory writable
- [ ] Log rotation working
- [ ] Health check endpoint accessible
- [ ] Error tracking configured (optional)

## 🎯 Performance

- [ ] Database indexes created
- [ ] Redis connection pooling configured
- [ ] Payload size limits set
- [ ] Static assets cached (frontend)

## ✅ Final Steps

- [ ] Test in staging environment first
- [ ] Backup database before deployment
- [ ] Document deployment process
- [ ] Have rollback plan ready
- [ ] Monitor logs after deployment
- [ ] Test critical flows after deployment

## 🚨 Emergency Contacts

Document who to contact if issues arise:

- **Backend Issues:** _______________
- **Database Issues:** _______________
- **Infrastructure:** _______________

## 📱 Post-Deployment

Within 1 hour:
- [ ] Check error logs
- [ ] Verify matchmaking works
- [ ] Verify code submission works
- [ ] Check database query performance

Within 24 hours:
- [ ] Monitor error rates
- [ ] Check response times
- [ ] Verify rate limiting
- [ ] Review log files

---

**Last Updated:** ${new Date().toISOString()}


