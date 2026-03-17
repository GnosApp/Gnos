document.addEventListener("DOMContentLoaded", () => {
    
    // 1. Intersection Observer for Scroll Animations
    // This looks for elements with the class 'fade-up' and adds 'visible' when they enter the viewport
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.15 // Triggers when 15% of the element is visible
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                // Optional: Stop observing once it has animated in
                observer.unobserve(entry.target); 
            }
        });
    }, observerOptions);

    // Select all elements with the fade-up class and observe them
    const fadeElements = document.querySelectorAll('.fade-up');
    fadeElements.forEach(el => observer.observe(el));

    // 2. Mock Form Submission
    const betaForm = document.getElementById('betaForm');
    if (betaForm) {
        betaForm.addEventListener('submit', (e) => {
            e.preventDefault(); // Prevent page reload
            const emailInput = betaForm.querySelector('input[type="email"]');
            const submitBtn = betaForm.querySelector('button');
            
            if(emailInput.value) {
                // Mock success state
                const originalText = submitBtn.textContent;
                submitBtn.textContent = "Applied!";
                submitBtn.style.backgroundColor = "var(--book-green)";
                emailInput.value = "";
                
                // Reset after 3 seconds
                setTimeout(() => {
                    submitBtn.textContent = originalText;
                    submitBtn.style.backgroundColor = "";
                }, 3000);
            }
        });
    }
});