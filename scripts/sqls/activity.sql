--recent activity

select 
    ip_address,count(1) cnt, max(cast(last_active_at as date)) lst
from user_sessions
group by ip_address
order by max(cast(last_active_at as date)) desc,count(1) desc
limit 50;