    // Navigation & Hamburger Logic
    const hamburger = document.getElementById('hamburger-toggle');
    const navMenu = document.getElementById('nav-menu');
    const navLinks = document.querySelectorAll('nav a');
    const sections = document.querySelectorAll('main section');

    // Toggle Menu
    hamburger.addEventListener('click', () => {
    	navMenu.classList.toggle('show-menu');
    	const icon = hamburger.querySelector('i');
    	icon.classList.toggle('fa-bars');
    	icon.classList.toggle('fa-times');
    });

    // Navigation and closing menu on click
    navLinks.forEach(link => {
    	link.addEventListener('click', (e) => {
    		e.preventDefault();
    		const target = link.dataset.target;

    		// UI Updates
    		navLinks.forEach(l => l.classList.remove('active'));
    		link.classList.add('active');

    		sections.forEach(s => {
    			s.classList.remove('active');
    			if (s.id === target) s.classList.add('active');
    		});

    		// Close mobile menu
    		navMenu.classList.remove('show-menu');
    		const icon = hamburger.querySelector('i');
    		icon.classList.add('fa-bars');
    		icon.classList.remove('fa-times');

    		window.scrollTo({
    			top: 0,
    			behavior: 'smooth'
    		});
    	});
    });

    // Theme Toggle
    const themeBtn = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');

    themeBtn.addEventListener('click', () => {
    	const isDark = document.body.classList.toggle('dark-theme');
    	themeIcon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    	localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });

    if (localStorage.getItem('theme') === 'dark') {
    	document.body.classList.add('dark-theme');
    	themeIcon.className = 'fas fa-sun';
    }

    // Modal Logic
    const modal = document.getElementById('image-modal');
    document.getElementById('profile-trigger').addEventListener('click', () => modal.classList.add('active'));
    modal.addEventListener('click', () => modal.classList.remove('active'));

    // Cursor Glow
    const glow = document.getElementById('cursor-glow');
    window.addEventListener('mousemove', (e) => {
    	glow.style.left = e.clientX + 'px';
    	glow.style.top = e.clientY + 'px';
    });

    // Data Viz
    
	
	
	document.addEventListener('DOMContentLoaded', () => {
    const vizToggle = document.getElementById('viz-toggle');
    const visualGraph = document.getElementById('visual-graph');
    let intervalId = null;

    function updateVisualization(type) {	
    const barContainer = document.getElementById('data-bars');
        for (let i = 0; i < 40; i++) {
    	const bar = document.createElement('div');
    	bar.className = 'data-bar';
    	bar.style.height = (Math.random() * 80) + '%';
    	barContainer.appendChild(bar);
    }
    setInterval(() => {
    	document.querySelectorAll('.data-bar').forEach(bar => {
    		bar.style.height = (Math.random() * 80) + '%';
    	});
    }, 700);
    }
	
	function updateVisualization2(type) {	
    const barContainer = document.getElementById('data-bars');
        for (let i = 0; i < 20; i++) {
    	const bar = document.createElement('div');
    	bar.className = 'data-bar';
    	bar.style.height = (Math.random() * 40) + '%';
    	barContainer.appendChild(bar);
    }
    setInterval(() => {
    	document.querySelectorAll('.data-bar').forEach(bar => {
    		bar.style.height = (Math.random() * 40) + '%';
    	});
    }, 700);
    }

    // Listen for dropdown changes
    vizToggle.addEventListener('change', (e) => {
        updateVisualization(e.target.value);
    });

    // Run once on load
    updateVisualization2(vizToggle.value);
});