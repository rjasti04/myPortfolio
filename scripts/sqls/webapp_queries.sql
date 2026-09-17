-- Distinct Users
select ip_address,count(1) cnt,min(started_at) frist_at,max(started_at) last_at from user_sessions 
group by ip_address
order by count(1) desc;